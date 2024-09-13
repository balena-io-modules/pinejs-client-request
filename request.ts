import type * as LruCache from 'lru-cache';
import type {
	Params,
	AnyObject,
	AnyResource,
	Resource,
} from 'pinejs-client-core';

import { PinejsClientCore } from 'pinejs-client-core';
import * as request from 'request';
import { TypedError } from 'typed-error';

const requestAsync = (
	opts:
		| (request.UriOptions & request.CoreOptions)
		| (request.UrlOptions & request.CoreOptions),
): Promise<request.Response> =>
	new Promise((resolve, reject) => {
		request(opts, (err: Error, response) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(response);
		});
	});

const headersOfInterest = ['retry-after'] as const;

export class StatusError extends TypedError {
	public headers: Pick<
		request.Response['headers'],
		(typeof headersOfInterest)[number]
	> = {};

	constructor(
		message: string,
		public statusCode: number,
		headers: request.Response['headers'],
	) {
		super(message);
		if (headers != null) {
			for (const header of headersOfInterest) {
				this.headers[header] = headers[header];
			}
		}
	}
}

interface CachedResponse {
	etag: string;
	body: any;
}

export interface BackendParams {
	cache?: LruCache.Options<string, CachedResponse>;
}

const validParams: Array<keyof BackendParams> = ['cache'];
export class PinejsClientRequest<
	Model extends {
		[key in keyof Model]: Resource;
	} = {
		[key in string]: AnyResource;
	},
> extends PinejsClientCore<unknown, Model> {
	public backendParams: BackendParams = {};
	private cache?: LruCache<string, CachedResponse>;

	constructor(params: Params, backendParams?: BackendParams) {
		if (params?.retry && params.retry.getRetryAfterHeader == null) {
			params = {
				...params,
				retry: {
					...params.retry,
					getRetryAfterHeader(err) {
						if (err instanceof StatusError) {
							return err.headers['retry-after'];
						}
					},
				},
			};
		}
		super(params);
		if (backendParams != null && typeof backendParams === 'object') {
			for (const validParam of validParams) {
				if (Object.prototype.hasOwnProperty.call(backendParams, validParam)) {
					this.backendParams[validParam] = backendParams[validParam];
				}
			}
		}
		if (this.backendParams.cache != null) {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const LRU = require('lru-cache') as typeof import('lru-cache');
			this.cache = new LRU(this.backendParams.cache);
		}
	}

	public async _request(
		params: {
			method: string;
			url: string;
			body?: AnyObject;
		} & AnyObject,
	): Promise<NonNullable<unknown>> {
		// We default to gzip on for efficiency.
		params.gzip ??= true;
		// We default to a 59s timeout, rather than hanging indefinitely.
		params.timeout ??= 59000;
		// We default to enforcing valid ssl certificates, after all there's a reason we're using them!
		params.strictSSL ??= true;
		// The request is always a json request.
		params.json = true;

		if (this.cache != null && params.method === 'GET') {
			// If the cache is enabled and we are doing a GET then try to use a cached
			// version, and store whatever the (successful) result is.
			let cached = this.cache.get(params.url);
			if (cached != null) {
				params.headers ??= {};
				params.headers['If-None-Match'] = cached.etag;
			}
			const { statusCode, body, headers } = await requestAsync(params);
			if (statusCode === 304 && cached != null) {
				// The currently cached version is still valid
			} else if (200 <= statusCode && statusCode < 300) {
				cached = {
					etag: headers.etag!,
					body,
				};
			} else {
				throw new StatusError(body, statusCode, headers);
			}

			this.cache.set(params.url, cached);
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { cloneDeep } = require('lodash') as typeof import('lodash');
			return cloneDeep(cached.body);
		} else {
			const { statusCode, body, headers } = await requestAsync(params);
			if (200 <= statusCode && statusCode < 300) {
				return body;
			}
			throw new StatusError(body, statusCode, headers);
		}
	}
}

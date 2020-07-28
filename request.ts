import type * as LruCache from 'lru-cache';

import { PinejsClientCore, Params, AnyObject } from 'pinejs-client-core';
import * as request from 'request';
import { TypedError } from 'typed-error';

const requestAsync = (
	opts:
		| (request.UriOptions & request.CoreOptions)
		| (request.UrlOptions & request.CoreOptions),
): Promise<request.Response> =>
	new Promise((resolve, reject) => {
		request(opts, (err, response) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(response);
		});
	});

export class StatusError extends TypedError {
	constructor(message: string, public statusCode: number) {
		super(message);
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
export class PinejsClientRequest extends PinejsClientCore<PinejsClientRequest> {
	public backendParams: BackendParams = {};
	private cache?: LruCache<string, CachedResponse>;

	constructor(params: Params, backendParams?: BackendParams) {
		super(params);
		if (backendParams != null && typeof backendParams === 'object') {
			for (const validParam of validParams) {
				if (backendParams.hasOwnProperty(validParam)) {
					this.backendParams[validParam] = backendParams[validParam];
				}
			}
		}
		if (this.backendParams.cache != null) {
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
	): Promise<{}> {
		// We default to gzip on for efficiency.
		if (params.gzip == null) {
			params.gzip = true;
		}
		// We default to a 59s timeout, rather than hanging indefinitely.
		if (params.timeout == null) {
			params.timeout = 59000;
		}
		// We default to enforcing valid ssl certificates, after all there's a reason we're using them!
		if (params.strictSSL == null) {
			params.strictSSL = true;
		}
		// The request is always a json request.
		params.json = true;

		if (this.cache != null && params.method === 'GET') {
			// If the cache is enabled and we are doing a GET then try to use a cached
			// version, and store whatever the (successful) result is.
			let cached = this.cache.get(params.url);
			if (cached != null) {
				if (params.headers == null) {
					params.headers = {};
				}
				params.headers['If-None-Match'] = cached.etag;
			}
			const { statusCode, body, headers } = await requestAsync(params);
			if (statusCode === 304 && cached != null) {
				// The currently cached version is still valid
			} else if (200 <= statusCode && statusCode < 300) {
				cached = {
					etag: headers.etag as string,
					body,
				};
			} else {
				throw new StatusError(body, statusCode);
			}

			this.cache!.set(params.url, cached);
			const { cloneDeep } = require('lodash') as typeof import('lodash');
			return cloneDeep(cached.body);
		} else {
			const { statusCode, body } = await requestAsync(params);
			if (200 <= statusCode && statusCode < 300) {
				return body;
			}
			throw new StatusError(body, statusCode);
		}
	}
}

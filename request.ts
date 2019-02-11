import * as _ from 'lodash'
import * as request from 'request'
import * as Promise from 'bluebird'
import { PinejsClientCoreFactory } from 'pinejs-client-core'
import TypedError = require('typed-error')

export { PinejsClientCoreFactory } from 'pinejs-client-core'

interface Cache {
	get(url: string): Promise<CachedResponse>
	set(url: string, value: CachedResponse): void
}
interface BluebirdLRU {
	(params: { [index: string]: any }): Cache
	NoSuchKeyError: TypedError
}
const BluebirdLRU: BluebirdLRU = require('bluebird-lru-cache')

const requestAsync = Promise.promisify(request)

export class StatusError extends TypedError {
	constructor(
		message: string,
		public statusCode: number
	) {
		super(message)
	}
}

interface CachedResponse {
	etag: string
	body: any
}

export interface BackendParams {
	cache?: {
		[index: string]: any
	}
}
type PromiseObj = Promise<{}>

const validParams: Array<keyof BackendParams> = ['cache']
const PinejsClientCore = PinejsClientCoreFactory(Promise)
export class PinejsClientRequest extends PinejsClientCore<PinejsClientRequest, PromiseObj, Promise<PinejsClientCoreFactory.PromiseResultTypes>> {
	backendParams: BackendParams = {}
	private cache?: Cache

	constructor(params: PinejsClientCoreFactory.Params, backendParams?: BackendParams) {
		super(params)
		if (backendParams != null && _.isObject(backendParams)) {
			_.assign(this.backendParams, _.pick(backendParams, validParams))
		}
		if (this.backendParams.cache != null) {
			this.cache = BluebirdLRU(this.backendParams.cache)
		}
	}

	_request(
		params: {
			method: string,
			url: string,
			body?: PinejsClientCoreFactory.AnyObject,
		} & PinejsClientCoreFactory.AnyObject
	): PromiseObj {
		// We default to gzip on for efficiency.
		if (params.gzip == null) {
			params.gzip = true
		}
		// We default to a 30s timeout, rather than hanging indefinitely.
		if (params.timeout == null) {
			params.timeout = 30000
		}
		// We default to enforcing valid ssl certificates, after all there's a reason we're using them!
		if (params.strictSSL == null) {
			params.strictSSL = true
		}
		// The request is always a json request.
		params.json = true

		if (this.cache != null && params.method === 'GET') {
			// If the cache is enabled and we are doing a GET then try to use a cached
			// version, and store whatever the (successful) result is.
			return this.cache.get(params.url).then((cached) => {
				if (params.headers == null) {
					params.headers = {}
				}
				params.headers['If-None-Match'] = cached.etag
				return requestAsync(params).then(({ statusCode, body, headers }): CachedResponse => {
					if (statusCode === 304) {
						return cached
					}
					if (200 <= statusCode && statusCode < 300) {
						return {
							etag: headers.etag as string,
							body
						}
					}
					throw new StatusError(body, statusCode)
				})
			}).catch(BluebirdLRU.NoSuchKeyError, () => {
				return requestAsync(params).then(({ statusCode, body, headers }): CachedResponse => {
					if (200 <= statusCode && statusCode < 300) {
						return {
							etag: headers.etag as string,
							body
						}
					}
					throw new StatusError(body, statusCode)
				})
			}).then((cached) => {
				this.cache!.set(params.url, cached)
				return _.cloneDeep(cached.body)
			})
		} else {
			return requestAsync(params).then(({ statusCode, body }) => {
				if (200 <= statusCode && statusCode < 300) {
					return body
				}
				throw new StatusError(body, statusCode)
			})
		}
	}
}

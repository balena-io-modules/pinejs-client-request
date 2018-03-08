import * as PinejsClientCoreFactory from 'pinejs-client-core/core'
import * as request from 'request'
import * as Promise from 'bluebird'

declare class PinejsClientRequest extends PinejsClientCoreFactory.PinejsClientCore<PinejsClientRequest, Promise<{}>, Promise<number | PinejsClientCoreFactory.AnyObject | PinejsClientCoreFactory.AnyObject[]>> {
	constructor(
		params: string | PinejsClientCoreFactory.Params,
		backendParams?: {
			cache: {
				[index: string]: any
			}
		}
	)

	_request(params: request.Options): Promise<{}>
}

export = PinejsClientRequest

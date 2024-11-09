import { DurableObject } from 'cloudflare:workers';

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class HiroApiDO extends DurableObject {
	private readonly CACHE_TTL: number = 3600;
	private readonly BASE_URL: string = 'https://api.hiro.so';
	private readonly BASE_PATH: string = '/hiro-api';

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		console.log('Trying to match the base path');
		console.log('Requested path: ', path);
		console.log('Base path: ', this.BASE_PATH);

		if (path.replace(this.BASE_PATH, '') === '/') {
			return new Response('Root');
		}

		if (path.startsWith(this.BASE_PATH)) {
			console.log('Matched base path');
			const endpoint = path.replace(this.BASE_PATH, '');
			if (endpoint === '/extended') {
				return new Response('/extended direct match');
			}
			if (endpoint === '/v2/info') {
				return new Response('/v2/info direct match');
			}
			if (endpoint.startsWith('/extended/v1/address/')) {
				const address = endpoint.split('/').pop();
				console.log('endpoint: ', endpoint);
				console.log('address: ', address);

				return new Response(`/extended/v1/address/${address}`);
			}
			return new Response(`Unrecognized requested endpoint: ${endpoint}`, { status: 404 });
		}

		return new Response(`Unrecognized path: ${path}`, { status: 404 });
	}
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith('/hiro-api')) {
			// Create a DurableObjectId for our instance
			let id: DurableObjectId = env.HIRO_API_DO.idFromName('hiro-api-do');

			// Get the stub for communication
			let stub = env.HIRO_API_DO.get(id);

			// Forward the request to the Durable Object
			return await stub.fetch(request);
		}

		// Return 404 for any other path
		return new Response('Invalid path', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

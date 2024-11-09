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

		console.log(`Fetching ${path}`);

		if (path === '/extended') {
			return new Response('/extended');
		}

		if (path === '/v2/info') {
			return new Response('/v2/info');
		}

		if (path.startsWith('/extended/v1/address/')) {
			const address = path.split('/').pop();
			return new Response(`/extended/v1/address/${address}`);
		}

		return new Response(`Invalid path: ${path}`, { status: 404 });
	}

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @param name - The name provided to a Durable Object instance from a Worker
	 * @returns The greeting to be sent back to the Worker
	 */
	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
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

import { DurableObject } from 'cloudflare:workers';
import { Env } from '../worker-configuration';

/**
 * Durable Object class for the Hiro API
 */
export class HiroApiDO extends DurableObject<Env> {
	private readonly CACHE_TTL: number = 3600;
	private readonly BASE_API_URL: string = 'https://api.hiro.so';
	private readonly BASE_PATH: string = '/hiro-api';
	private readonly SUPPORTED_PATHS: string[] = ['/extended', '/v2/info', '/extended/v1/address/'];

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.env = env;
	}

	private async fetchWithCache(endpoint: string, cacheKey: string, cacheTtl: number = this.CACHE_TTL): Promise<Response> {
		// try to get value from KV first
		const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);
		if (cached) {
			console.log('Found value in KV');
			return new Response(cached, {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// if not in KV, try to fetch from API
		try {
			// set up the query based on matching endpoint
			const url = new URL(endpoint, this.BASE_API_URL);
			const response = await fetch(url);
			// pass along errors if any
			if (!response.ok) {
				return new Response(
					JSON.stringify({
						error: `Error fetching data from Hiro API: ${response.statusText}`,
					}),
					{
						status: response.status,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}
			// parse the response and cache it
			const data = await response.text();
			await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, data, { expirationTtl: cacheTtl });
			return new Response(data);
		} catch (error) {
			if (error instanceof Error) {
				return new Response(
					JSON.stringify({
						error: `Error fetching data from Hiro API: ${error.message}`,
					}),
					{
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}
			return new Response(
				JSON.stringify({
					error: 'Unknown error fetching data from Hiro API',
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// handle requests that don't match the base path
		if (!path.startsWith(this.BASE_PATH)) {
			return new Response(
				JSON.stringify({
					error: `Unrecognized path passed to HiroApiDO: ${path}`,
				}),
				{
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// parse requested endpoint from base path
		const endpoint = path.replace(this.BASE_PATH, '');

		// handle requests to the root route
		if (endpoint === '' || endpoint === '/') {
			return new Response(
				JSON.stringify({
					message: 'Reached root path',
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// handle unsupported endpoints
		const isSupported = this.SUPPORTED_PATHS.some(
			(path) =>
				endpoint === path || // exact match
				(path.endsWith('/') && endpoint.startsWith(path)) // prefix match for paths ending with /
		);

		if (!isSupported) {
			return new Response(
				JSON.stringify({
					error: `Unsupported endpoint: ${endpoint}`,
					supportedEndpoints: this.SUPPORTED_PATHS,
				}),
				{
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// create cache key from endpoint
		const cacheKey = `hiro_api_${endpoint.replace('/', '_')}`;

		// handle /extended path
		if (endpoint === '/extended') {
			return this.fetchWithCache(endpoint, cacheKey);
		}

		// handle /v2/info path
		if (endpoint === '/v2/info') {
			return this.fetchWithCache(endpoint, cacheKey);
		}

		// handle /extended/v1/address path
		if (endpoint.startsWith('/extended/v1/address/')) {
			// Remove '/extended/v1/address/' from the start
			const pathParts = endpoint.replace('/extended/v1/address/', '').split('/');

			if (pathParts.length < 2) {
				return new Response(
					JSON.stringify({
						error: 'Invalid address path format',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			const address = pathParts[0];
			const action = pathParts[1];

			// Validate the action
			const validActions = ['assets', 'balances'];
			if (!validActions.includes(action)) {
				return new Response(
					JSON.stringify({
						error: `Invalid action: ${action}`,
						validActions: validActions,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			return new Response(
				JSON.stringify({
					address,
					action,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// return 404 for any other endpoint
		return new Response(
			JSON.stringify({
				error: `Unrecognized endpoint: ${endpoint}`,
			}),
			{
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			}
		);
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
		const path = url.pathname;

		if (path.startsWith('/hiro-api')) {
			// Create a DurableObjectId for our instance
			let id: DurableObjectId = env.HIRO_API_DO.idFromName('hiro-api-do');

			// Get the stub for communication
			let stub = env.HIRO_API_DO.get(id);

			// Forward the request to the Durable Object
			return await stub.fetch(request);
		}

		// Return 404 for any other path
		return new Response(
			JSON.stringify({
				error: 'Invalid path',
			}),
			{
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	},
} satisfies ExportedHandler<Env>;

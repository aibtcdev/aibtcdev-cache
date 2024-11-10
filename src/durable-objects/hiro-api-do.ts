import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { APP_CONFIG } from '../config';
import { RateLimitedFetcher } from '../rate-limiter';

/**
 * Durable Object class for the Hiro API
 */
export class HiroApiDO extends DurableObject<Env> {
	// can override values here for all endpoints
	private readonly CACHE_TTL: number = APP_CONFIG.CACHE_TTL;
	private readonly MAX_REQUESTS_PER_MINUTE = APP_CONFIG.MAX_REQUESTS_PER_MINUTE;
	private readonly INTERVAL_MS = APP_CONFIG.INTERVAL_MS;
	// settings specific to this Durable Object
	private readonly BASE_API_URL: string = 'https://api.hiro.so';
	private readonly BASE_PATH: string = '/hiro-api';
	private readonly SUPPORTED_PATHS: string[] = ['/extended', '/v2/info', '/extended/v1/address/'];
	// custom fetcher with KV cache logic and rate limiting
	private fetcher: RateLimitedFetcher;

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
		this.fetcher = new RateLimitedFetcher(this.MAX_REQUESTS_PER_MINUTE, this.INTERVAL_MS, this.env, this.BASE_API_URL, this.CACHE_TTL);
	}

	// helper function to fetch data from KV cache with rate limiting for API calls
	private async fetchWithCache(endpoint: string, cacheKey: string): Promise<Response> {
		return this.fetcher.fetch(endpoint, cacheKey);
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
					message: `Welcome to the hiro-api cache! Supported endpoints: ${this.SUPPORTED_PATHS.join(', ')}`,
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

			// get address and action from parts
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

			// Construct the endpoint path
			const apiEndpoint = `/extended/v1/address/${address}/${action}`;
			return this.fetchWithCache(apiEndpoint, cacheKey);
		}

		// return 404 for any other endpoint
		return new Response(
			JSON.stringify({
				error: `Unrecognized endpoint: ${endpoint}. Supported endpoints: ${this.SUPPORTED_PATHS.join(', ')}`,
			}),
			{
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

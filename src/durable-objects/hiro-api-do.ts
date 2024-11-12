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
	private readonly ALARM_INTERVAL_MS = APP_CONFIG.ALARM_INTERVAL_MS;
	// settings specific to this Durable Object
	private readonly BASE_API_URL: string = 'https://api.hiro.so';
	private readonly BASE_PATH: string = '/hiro-api';
	private readonly SUPPORTED_PATHS: string[] = ['/extended', '/v2/info', '/extended/v1/address/', '/test-rate-limiter'];
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
		this.ctx = ctx;
		this.env = env;
		this.fetcher = new RateLimitedFetcher(this.MAX_REQUESTS_PER_MINUTE, this.INTERVAL_MS, this.env, this.BASE_API_URL, this.CACHE_TTL);

		// Set up alarm to run at configured interval
		ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

	async alarm(): Promise<void> {
		// Get all unique addresses from KV cache
		const addresses = await this.extractAddressesFromKV();

		// Update cache for each address
		for (const address of addresses) {
			const endpoints = [`/extended/v1/address/${address}/assets`, `/extended/v1/address/${address}/balances`];
			for (const endpoint of endpoints) {
				const cacheKey = `hiro_api_${endpoint.replace('/', '_')}`;
				await this.fetchWithCache(endpoint, cacheKey);
			}
		}

		// Log the number of addresses updated
		console.log(`Updated cache for ${addresses.length} addresses`);

		// Schedule next alarm
		this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

	private async extractAddressesFromKV(): Promise<string[]> {
		const addresses = new Set<string>();
		let cursor: string | null = null;

		do {
			const result: KVNamespaceListResult<string, string> = await this.env.AIBTCDEV_CACHE_KV.list({ cursor });
			if (result.list_complete === false && result.cursor) {
				cursor = result.cursor;
			} else {
				cursor = null;
			}

			for (const key of result.keys) {
				// Look for keys matching address pattern
				const match = key.name.match(/hiro_api_extended_v1_address_([A-Z0-9]+)_(assets|balances)/);
				if (match) {
					addresses.add(match[1]);
				}
			}
		} while (cursor != null);

		return Array.from(addresses);
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

		// handle /test-rate-limiter path
		// this will test the rate limiter and return the timings for each request
		// as well as the total time taken for all requests
		// and the current queue length and window requests count
		if (endpoint === '/test-rate-limiter') {
			const testResults: any = {
				timings: {},
				totalTime: 0,
				queueStats: {
					currentQueueLength: this.fetcher.getQueueLength(),
					currentWindowRequests: this.fetcher.getWindowRequestsCount(),
				},
			};

			const startTime = Date.now();
			const testEndpoints = [
				'/extended',
				'/v2/info',
				'/extended/v1/address/SP3NRRJS9BNEDJN9WG7CNVQ247N9DHFVSQRJ3RC8J/assets',
				'/extended/v1/address/SP3NRRJS9BNEDJN9WG7CNVQ247N9DHFVSQRJ3RC8J/balances',
				'/extended/v1/address/SP2E7W684Z809YQ9Q9JVDT0G8VJPQGDZPAGAJQ70A/assets',
				'/extended/v1/address/SP2E7W684Z809YQ9Q9JVDT0G8VJPQGDZPAGAJQ70A/balances',
				'/extended/v1/address/SP312TQ306SD7B7J2BPXKGBBYV780QGJJQSTVBT7N/assets',
				'/extended/v1/address/SP312TQ306SD7B7J2BPXKGBBYV780QGJJQSTVBT7N/balances',
				'/extended/v1/address/SPC2XBKQ3XCPS19MWNXM46QV801GAZ42JQGHJYM6/assets',
				'/extended/v1/address/SPC2XBKQ3XCPS19MWNXM46QV801GAZ42JQGHJYM6/balances',
				'/extended/v1/address/SP2F0DD3X3QDZW1AQS4SCM8N1BYKYAY0831JFDP9J/assets',
				'/extended/v1/address/SP2F0DD3X3QDZW1AQS4SCM8N1BYKYAY0831JFDP9J/balances',
				'/extended/v1/address/SPZC8995Q7DP1MFZFS2D6DY8A666E2GCDKV2QYYD/assets',
				'/extended/v1/address/SPZC8995Q7DP1MFZFS2D6DY8A666E2GCDKV2QYYD/balances',
				'/extended/v1/address/SP24YYHW29XPA1784W7CTD5PVPH0649PX7PEP5ZP6/assets',
				'/extended/v1/address/SP24YYHW29XPA1784W7CTD5PVPH0649PX7PEP5ZP6/balances',
				'/extended/v1/address/SPY1WRZ16ZCX6BP5FJTC1TS7BVXYCGTKDWFAS09J/assets',
				'/extended/v1/address/SPY1WRZ16ZCX6BP5FJTC1TS7BVXYCGTKDWFAS09J/balances',
				'/extended/v1/address/SP94EJNY5JS6XM2JJGFHPN4067X6FNKQ50ZM6BV5/assets',
				'/extended/v1/address/SP94EJNY5JS6XM2JJGFHPN4067X6FNKQ50ZM6BV5/balances',
				'/extended/v1/address/SP6PAMVVD7MY89G80B4CG8NS4M7VGYJZQYHANHH0/assets',
				'/extended/v1/address/SP6PAMVVD7MY89G80B4CG8NS4M7VGYJZQYHANHH0/balances',
			];

			const requests = testEndpoints.map(async (testEndpoint) => {
				const requestStart = Date.now();
				const cacheKey = `hiro_api_${testEndpoint.replace('/', '_')}`;
				const response = await this.fetchWithCache(testEndpoint, cacheKey);
				const requestEnd = Date.now();

				testResults.timings[testEndpoint] = {
					duration: requestEnd - requestStart,
					timestamp: new Date(requestStart).toISOString(),
					currentQueueLength: this.fetcher.getQueueLength(),
					currentWindowRequests: this.fetcher.getWindowRequestsCount(),
				};

				return response;
			});

			await Promise.all(requests);
			testResults.totalTime = Date.now() - startTime;

			return new Response(JSON.stringify(testResults, null, 2), {
				headers: { 'Content-Type': 'application/json' },
			});
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

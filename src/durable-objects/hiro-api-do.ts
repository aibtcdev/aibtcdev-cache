import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { corsHeaders } from '../utils';
import { RateLimitedFetcher } from '../rate-limiter';

/**
 * Durable Object class for the Hiro API
 */
export class HiroApiDO extends DurableObject<Env> {
	// can override values here for all endpoints
	private readonly CACHE_TTL: number;
	private readonly MAX_REQUESTS_PER_MINUTE: number;
	private readonly INTERVAL_MS: number;
	private readonly MAX_RETRIES: number;
	private readonly RETRY_DELAY: number;
	private readonly ALARM_INTERVAL_MS: number;
	// settings specific to this Durable Object
	private readonly BASE_API_URL: string = 'https://api.hiro.so';
	private readonly BASE_PATH: string = '/hiro-api';
	private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
	private readonly SUPPORTED_PATHS: string[] = ['/extended', '/v2/info', '/extended/v1/address/', '/known-addresses'];
	private readonly KNOWN_ADDRESSES_KEY = 'known_addresses';
	// custom fetcher with KV cache logic and rate limiting
	private fetcher: RateLimitedFetcher;

	// Get all known addresses from DO storage
	private async getKnownAddresses(): Promise<string[]> {
		const addresses = await this.ctx.storage.get<string[]>(this.KNOWN_ADDRESSES_KEY);
		return addresses || [];
	}

	// Store a new address if it doesn't exist
	private async addKnownAddress(address: string): Promise<void> {
		const addresses = await this.getKnownAddresses();
		if (!addresses.includes(address)) {
			addresses.push(address);
			await this.ctx.storage.put(this.KNOWN_ADDRESSES_KEY, addresses);
		}
	}

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

		// Initialize AppConfig with environment
		const config = AppConfig.getInstance(env).getConfig();

		// Set configuration values
		this.CACHE_TTL = config.CACHE_TTL;
		this.MAX_REQUESTS_PER_MINUTE = config.MAX_REQUESTS_PER_INTERVAL;
		this.INTERVAL_MS = config.INTERVAL_MS;
		this.MAX_RETRIES = config.MAX_RETRIES;
		this.RETRY_DELAY = config.RETRY_DELAY;
		this.ALARM_INTERVAL_MS = config.ALARM_INTERVAL_MS;

		this.fetcher = new RateLimitedFetcher(
			this.env,
			this.BASE_API_URL,
			this.CACHE_TTL,
			this.MAX_REQUESTS_PER_MINUTE,
			this.INTERVAL_MS,
			this.MAX_RETRIES,
			this.RETRY_DELAY
		);

		// Set up alarm to run at configured interval
		ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

	async alarm(): Promise<void> {
		const startTime = Date.now();
		try {
			// Get addresses from DO storage instead of KV
			const addresses = await this.getKnownAddresses();
			const addressFetchStartTime = Date.now();
			console.log(`Starting update for ${addresses.length} known addresses`);

			// Track success/failure for each address
			const results = {
				success: 0,
				failed: 0,
				errors: [] as string[],
			};

			// Update cache for each address
			for (const address of addresses) {
				const endpoints = [`/extended/v1/address/${address}/balances`]; // `/extended/v1/address/${address}/assets`
				for (const endpoint of endpoints) {
					try {
						const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;
						await this.fetchWithCache(endpoint, cacheKey, true);
						results.success++;
					} catch (error) {
						results.failed++;
						results.errors.push(`Failed to update ${address} (${endpoint}): ${error instanceof Error ? error.message : String(error)}`);
						// Continue with next endpoint despite error
						continue;
					}
				}
			}

			const endTime = Date.now();
			const totalDuration = endTime - startTime;
			const fetchDuration = endTime - addressFetchStartTime;
			const setupDuration = addressFetchStartTime - startTime;

			console.log(
				`hiro-api-do: alarm executed, ${addresses.length} addresses, setup ${setupDuration}ms, fetch: ${fetchDuration}ms, total ${totalDuration}ms, success: ${results.success}, failed: ${results.failed}`
			);
		} catch (error) {
			console.error(`Alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Always schedule next alarm if one isn't set
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm === null) {
				this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
			}
		}
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
				const match = key.name.match(/hiro-api_extended_v1_address_([A-Z0-9]+)_(assets|balances)/);
				if (match) {
					addresses.add(match[1]);
				}
			}
		} while (cursor != null);

		return Array.from(addresses);
	}

	// helper function to fetch data from KV cache with rate limiting for API calls
	private async fetchWithCache(endpoint: string, cacheKey: string, bustCache = false): Promise<Response> {
		return this.fetcher.fetch(endpoint, cacheKey, bustCache);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Always schedule next alarm if one isn't set
		const currentAlarm = await this.ctx.storage.getAlarm();
		if (currentAlarm === null) {
			this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
		}

		// handle requests that don't match the base path
		if (!path.startsWith(this.BASE_PATH)) {
			return new Response(
				JSON.stringify({
					error: `Unrecognized path passed to HiroApiDO: ${path}`,
				}),
				{
					status: 404,
					headers: { 
						'Content-Type': 'application/json',
						...corsHeaders(request.headers.get('Origin') || undefined)
					},
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
					headers: { 
						'Content-Type': 'application/json',
						...corsHeaders(request.headers.get('Origin') || undefined)
					},
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
					headers: { 
						'Content-Type': 'application/json',
						...corsHeaders(request.headers.get('Origin') || undefined)
					},
				}
			);
		}

		// create cache key from endpoint
		const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;

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

			// Store the address when it's requested
			await this.addKnownAddress(address);

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

		// handle /known-addresses path
		if (endpoint === '/known-addresses') {
			const [storageAddresses, cacheAddresses] = await Promise.all([this.getKnownAddresses(), this.extractAddressesFromKV()]);
			const uncachedAddresses = storageAddresses.filter((address) => !cacheAddresses.includes(address));

			return new Response(
				JSON.stringify(
					{
						stats: {
							storage: storageAddresses.length,
							cached: cacheAddresses.length,
							uncached: uncachedAddresses.length,
						},
						addresses: {
							storage: storageAddresses,
							cached: cacheAddresses,
							uncached: uncachedAddresses,
						},
					},
					null,
					2
				),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// return 404 for any other endpoint
		return new Response(
			JSON.stringify({
				error: `Unrecognized endpoint: ${endpoint}. Supported endpoints: ${this.SUPPORTED_PATHS.join(', ')}`,
			}),
			{
				status: 404,
				headers: { 
					'Content-Type': 'application/json',
					...corsHeaders(request.headers.get('Origin') || undefined)
				},
			}
		);
	}
}

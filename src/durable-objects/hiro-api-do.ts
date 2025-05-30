import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { ApiRateLimiterService } from '../services/api-rate-limiter-service';
import { getKnownAddresses, addKnownAddress } from '../utils/address-store-util';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { handleRequest } from '../utils/request-handler-util';

/**
 * Interface representing information about known Stacks addresses
 *
 * This structure is used to return information about addresses that
 * have been stored and/or cached by the Durable Object.
 */
interface KnownAddressInfo {
	stats: {
		storage: number;
		cached: number;
		uncached: number;
	};
	addresses: {
		storage: string[];
		cached: string[];
		uncached: string[];
	};
}

/**
 * Durable Object class for proxying and caching Hiro API requests
 *
 * This Durable Object provides a rate-limited and cached interface to the Hiro API,
 * which is the primary API service for the Stacks blockchain. It handles:
 *
 * 1. Proxying requests to the Hiro API with rate limiting
 * 2. Caching responses to reduce API calls
 * 3. Tracking known Stacks addresses for background updates
 * 4. Providing endpoints for blockchain data like address balances and assets
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
	private readonly BASE_API_URL: string = 'https://api.hiro.so/';
	private readonly BASE_PATH: string = '/hiro-api';
	private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
	private readonly SUPPORTED_ENDPOINTS: string[] = ['/extended', '/v2/info', '/extended/v1/address/', '/known-addresses'];
	// custom fetcher with KV cache logic and rate limiting
	private fetcher: ApiRateLimiterService;

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

		this.fetcher = new ApiRateLimiterService(
			this.env,
			this.BASE_API_URL,
			this.CACHE_TTL,
			this.MAX_REQUESTS_PER_MINUTE,
			this.INTERVAL_MS,
			this.MAX_RETRIES,
			this.RETRY_DELAY
		);

		// Set up alarm to run at configured interval
		// ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

	/**
	 * Extracts all Stacks addresses that have cached data
	 *
	 * This method scans the KV cache for keys matching the pattern for
	 * address-related data and extracts the unique addresses.
	 *
	 * @returns A promise that resolves to an array of unique Stacks addresses
	 */
	private async extractAddressesFromCache(): Promise<string[]> {
		const addresses = new Set<string>();
		let cursor: string | null = null;

		do {
			const result: KVNamespaceListResult<string, string> = await this.env.AIBTCDEV_CACHE_KV.list({
				cursor,
				prefix: 'hiro-api_extended_v1_address_',
			});
			cursor = result.list_complete ? null : result.cursor;

			for (const key of result.keys) {
				const match = key.name.match(/hiro-api_extended_v1_address_([A-Z0-9]+)_(assets|balances)/);
				if (match) {
					addresses.add(match[1]);
				}
			}
		} while (cursor != null);

		return Array.from(addresses);
	}

	/**
	 * Alarm handler that periodically updates cached address data
	 *
	 * This method:
	 * 1. Retrieves all known Stacks addresses from KV storage
	 * 2. Updates the balance and asset data for each address
	 * 3. Tracks success and failure statistics
	 * 4. Logs the results of the update process
	 *
	 * @returns A promise that resolves when the alarm handler completes
	 */
	async alarm(): Promise<void> {
		const startTime = Date.now();
		try {
			// Get addresses from KV storage
			const addresses = await getKnownAddresses(this.env);
			console.log(`HiroApiDO: updating ${addresses.length} known addresses`);

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
						results.errors.push(
							`HiroApiDO: failed to update ${address} (${endpoint}): ${error instanceof Error ? error.message : String(error)}`
						);
						// Continue with next endpoint despite error
						continue;
					}
				}
			}

			const endTime = Date.now();
			const totalDuration = endTime - startTime;

			console.log(
				`HiroApiDO: ${addresses.length} addresses updated in ${totalDuration}ms, success: ${results.success}, failed: ${results.failed}`
			);
		} catch (error) {
			console.error(`HiroApiDO: alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Always schedule next alarm if one isn't set
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm === null) {
				// this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
			}
		}
	}

	/**
	 * Helper function to fetch data from KV cache with rate limiting for API calls
	 *
	 * This method:
	 * 1. Checks the cache for the requested data
	 * 2. If not found or cache bust requested, fetches from the Hiro API
	 * 3. Applies rate limiting to prevent API abuse
	 * 4. Stores successful responses in the cache
	 *
	 * @param endpoint - The API endpoint to fetch
	 * @param cacheKey - The key to use for caching
	 * @param bustCache - Whether to ignore the cache and force a fresh fetch
	 * @returns A Response object with the requested data
	 */
	private async fetchWithCache(endpoint: string, cacheKey: string, bustCache = false): Promise<Response> {
		return this.fetcher.fetch(endpoint, cacheKey, bustCache);
	}

	/**
	 * Main request handler for the Hiro API Durable Object
	 *
	 * Handles the following endpoints:
	 * - / - Returns a list of supported endpoints
	 * - /extended - Proxies to the Hiro extended API
	 * - /v2/info - Proxies to the Hiro v2 info endpoint
	 * - /extended/v1/address/{address}/{action} - Fetches address data (balances/assets)
	 * - /known-addresses - Lists all addresses being tracked
	 *
	 * @param request - The incoming HTTP request
	 * @returns A Response object with the requested data or an error message
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Always schedule next alarm if one isn't set
		const currentAlarm = await this.ctx.storage.getAlarm();
		if (currentAlarm === null) {
			// this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
		}

		return handleRequest(
			async () => {
				// handle requests that don't match the base path
				if (!path.startsWith(this.BASE_PATH)) {
					throw new ApiError(ErrorCode.NOT_FOUND, {
						resource: path,
						basePath: this.BASE_PATH,
					});
				}

				// parse requested endpoint from base path
				const endpoint = path.replace(this.BASE_PATH, '');

				// handle root route
				if (endpoint === '' || endpoint === '/') {
					return {
						message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
					};
				}

				// handle unsupported endpoints
				const isSupported = this.SUPPORTED_ENDPOINTS.some(
					(path) =>
						endpoint === path || // exact match
						(path.endsWith('/') && endpoint.startsWith(path)) // prefix match for paths ending with /
				);

				if (!isSupported) {
					throw new ApiError(ErrorCode.NOT_FOUND, {
						resource: endpoint,
						supportedEndpoints: this.SUPPORTED_ENDPOINTS,
					});
				}

				// create cache key from endpoint
				const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;

				// handle /extended path
				if (endpoint === '/extended') {
					const response = await this.fetchWithCache(endpoint, cacheKey);
					return await response.json();
				}

				// handle /v2/info path
				if (endpoint === '/v2/info') {
					const response = await this.fetchWithCache(endpoint, cacheKey);
					return await response.json();
				}

				// handle /extended/v1/address path
				if (endpoint.startsWith('/extended/v1/address/')) {
					// Remove '/extended/v1/address/' from the start
					const pathParts = endpoint.replace('/extended/v1/address/', '').split('/');

					if (pathParts.length < 2) {
						throw new ApiError(ErrorCode.INVALID_REQUEST, {
							reason: 'Invalid address path format, expected: /extended/v1/address/{address}/{action}',
						});
					}

					// get address and action from parts
					const address = pathParts[0];
					const action = pathParts[1];

					// Store the address when it's requested
					await addKnownAddress(this.env, address);

					// Validate the action
					const validActions = ['assets', 'balances'];
					if (!validActions.includes(action)) {
						throw new ApiError(ErrorCode.INVALID_REQUEST, {
							reason: `Invalid action: ${action}`,
							validActions,
						});
					}

					// Construct the endpoint path
					const apiEndpoint = `/extended/v1/address/${address}/${action}`;
					const response = await this.fetchWithCache(apiEndpoint, cacheKey);
					return await response.json();
				}

				// handle /known-addresses path
				if (endpoint === '/known-addresses') {
					const [knownAddresses, cachedAddresses] = await Promise.all([getKnownAddresses(this.env), this.extractAddressesFromCache()]);
					const uncachedAddresses = knownAddresses.filter((address) => !cachedAddresses.includes(address));

					return {
						stats: {
							storage: knownAddresses.length,
							cached: cachedAddresses.length,
							uncached: uncachedAddresses.length,
						},
						addresses: {
							storage: knownAddresses,
							cached: cachedAddresses,
							uncached: uncachedAddresses,
						},
					};
				}

				// This should never happen due to the isSupported check above
				throw new ApiError(ErrorCode.NOT_FOUND, {
					resource: endpoint,
					supportedEndpoints: this.SUPPORTED_ENDPOINTS,
				});
			},
			this.env,
			{
				slowThreshold: 1500, // 1.5 seconds
			}
		);
	}
}

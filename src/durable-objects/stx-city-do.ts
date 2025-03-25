import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { ApiRateLimiterService } from '../services/api-rate-limiter-service';
import { createSuccessResponse, createErrorResponse } from '../utils/requests-responses-util';
import { ApiError } from '../utils/api-error';
import { ErrorCode } from '../utils/error-catalog';
import { handleRequest } from '../utils/request-handler';

/**
 * Represents token metrics from STX.city
 *
 * Contains various numerical metrics about a token's performance and usage.
 */
type Metrics = {
	price_usd: number;
	holder_count: number;
	swap_count: number;
	transfer_count: number;
	liquidity_usd: number;
};

/**
 * Represents social media links for a token
 */
type Socials = {
	platform: string;
	value: string;
};

/**
 * Comprehensive details about a token from STX.city
 *
 * Contains all information about a token including its contract details,
 * supply information, metrics, social links, and descriptive content.
 */
type TokenDetails = {
	contract_id: string;
	symbol: string;
	name: string;
	decimals: number;
	total_supply: number | string;
	circulating_supply: number | string;
	image_url: string;
	header_image_url?: string | null;
	metrics: Metrics;
	amms: string[];
	description: string;
	homepage?: string;
	telegram?: string;
	xlink?: string;
	discord?: string;
	verified?: boolean;
	socials?: Socials[];
};

/**
 * Durable Object class for proxying and caching STX.city API requests
 *
 * This Durable Object provides a rate-limited and cached interface to the STX.city API,
 * which offers data about tokens on the Stacks blockchain. It handles:
 *
 * 1. Proxying requests to the STX.city API with rate limiting
 * 2. Caching responses to reduce API calls
 * 3. Providing endpoints for token data and trading information
 */
export class StxCityDO extends DurableObject<Env> {
	// can override values here for all endpoints
	private readonly CACHE_TTL: number;
	private readonly MAX_REQUESTS_PER_MINUTE: number;
	private readonly INTERVAL_MS: number;
	private readonly MAX_RETRIES: number;
	private readonly RETRY_DELAY: number;
	private readonly ALARM_INTERVAL_MS = 60000; // 1 minute
	// settings specific to this Durable Object
	private readonly BASE_API_URL: string = 'https://stx.city/api';
	private readonly BASE_PATH: string = '/stx-city';
	private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
	private readonly SUPPORTED_ENDPOINTS: string[] = ['/tokens/tradable-full-details-tokens'];
	// custom fetcher with KV cache logic and rate limiting
	private fetcher: ApiRateLimiterService;

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
	 * Alarm handler that periodically updates cached endpoints
	 *
	 * This method:
	 * 1. Iterates through all supported endpoints
	 * 2. Refreshes the cache for each endpoint
	 * 3. Logs statistics about the update process
	 *
	 * @returns A promise that resolves when the alarm handler completes
	 */
	async alarm(): Promise<void> {
		const startTime = Date.now();
		try {
			console.log('StxCityDO: updating cached endpoints');

			const endpoints = this.SUPPORTED_ENDPOINTS.map((path) => path);

			for (const endpoint of endpoints) {
				const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;
				await this.fetchWithCache(endpoint, cacheKey, true);
			}

			const endTime = Date.now();
			const totalDuration = endTime - startTime;
			console.log(`StxCityDO: cache updated in ${totalDuration}ms`);
		} catch (error) {
			console.error(`StxCityDO: alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
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
	 * 2. If not found or cache bust requested, fetches from the STX.city API
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
	 * Main request handler for the STX.city API Durable Object
	 *
	 * Handles the following endpoints:
	 * - / - Returns a list of supported endpoints
	 * - /tokens/tradable-full-details-tokens - Returns details about tradable tokens
	 *
	 * @param request - The incoming HTTP request
	 * @returns A Response object with the requested data or an error message
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Schedule next alarm if one isn't set
		const currentAlarm = await this.ctx.storage.getAlarm();
		if (currentAlarm === null) {
			// this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
		}

		return handleRequest(
			async () => {
				// Handle requests that don't match the base path
				if (!path.startsWith(this.BASE_PATH)) {
					throw new ApiError(ErrorCode.NOT_FOUND, {
						resource: path,
						basePath: this.BASE_PATH,
					});
				}

				// Parse requested endpoint from base path
				const endpoint = path.replace(this.BASE_PATH, '');

				// Handle root route
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

				// handle /tokens/tradable-full-details-tokens path
				if (endpoint === '/tokens/tradable-full-details-tokens') {
					const response = await this.fetchWithCache(endpoint, cacheKey);
					return await response.json();
				}

				// This should never happen due to the isSupported check above
				throw new ApiError(ErrorCode.NOT_FOUND, {
					resource: endpoint,
					supportedEndpoints: this.SUPPORTED_ENDPOINTS,
				});
			},
			this.env,
			{
				slowThreshold: 2500, // Token data can be large and slow to process
			}
		);
	}
}

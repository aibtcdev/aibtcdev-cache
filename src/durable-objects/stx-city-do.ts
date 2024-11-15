import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { createJsonResponse } from '../utils/requests-responses';
import { RateLimitedFetcher } from '../rate-limiter';

type Metrics = {
	price_usd: number;
	holder_count: number;
	swap_count: number;
	transfer_count: number;
	liquidity_usd: number;
};

type Socials = {
	platform: string;
	value: string;
};

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
 * Durable Object class for STXCITY queries
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
	private fetcher: RateLimitedFetcher;

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
				this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
			}
		}
	}

	// helper function to fetch data from KV cache with rate limiting for API calls
	private async fetchWithCache(endpoint: string, cacheKey: string, bustCache = false): Promise<Response> {
		return this.fetcher.fetch(endpoint, cacheKey, bustCache);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Schedule next alarm if one isn't set
		const currentAlarm = await this.ctx.storage.getAlarm();
		if (currentAlarm === null) {
			this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
		}

		// Handle requests that don't match the base path
		if (!path.startsWith(this.BASE_PATH)) {
			return createJsonResponse(
				{
					error: `Request at ${path} does not start with base path ${this.BASE_PATH}`,
				},
				404
			);
		}

		// Parse requested endpoint from base path
		const endpoint = path.replace(this.BASE_PATH, '');

		// Handle root route
		if (endpoint === '' || endpoint === '/') {
			return createJsonResponse({
				message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			});
		}

		// handle unsupported endpoints
		const isSupported = this.SUPPORTED_ENDPOINTS.some(
			(path) =>
				endpoint === path || // exact match
				(path.endsWith('/') && endpoint.startsWith(path)) // prefix match for paths ending with /
		);

		if (!isSupported) {
			return createJsonResponse(
				{
					error: `Unsupported endpoint: ${endpoint}, supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
				},
				404
			);
		}

		// create cache key from endpoint
		const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;

		// handle /tokens/tradable-full-details-tokens path
		if (endpoint === '/tokens/tradable-full-details-tokens') {
			console.log(`fetching: ${endpoint} stored at ${cacheKey}`);
			return await this.fetchWithCache(endpoint, cacheKey);
		}

		// Return 404 for any other endpoint
		return createJsonResponse(
			{
				error: `Unsupported endpoint: ${endpoint}, supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			},
			404
		);
	}
}

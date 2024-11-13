import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { corsHeaders } from '../utils';
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
	private jsonResponse(body: unknown, status = 200): Response {
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status,
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders(),
			},
		});
	}
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
	private readonly SUPPORTED_PATHS: string[] = ['/tokens/tradable-full-details-tokens'];
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
			console.log('StxCityDO: updating cache');

			const endpoints = this.SUPPORTED_PATHS.map((path) => `${this.BASE_API_URL}${path}`);

			for (const endpoint of endpoints) {
				const cacheKey = `${this.CACHE_PREFIX}_${endpoint.replaceAll('/', '_')}`;
				await this.fetchWithCache(endpoint, cacheKey, true);
			}

			const endTime = Date.now();
			const totalDuration = endTime - startTime;
			console.log(`StxCityDO: cache updated in ${totalDuration}ms`);
		} catch (error) {
			console.error(`Alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Schedule next alarm
			this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
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
			return this.jsonResponse(
				{
					error: `Unrecognized path passed to StxCityDO: ${path}`,
				},
				404
			);
		}

		// Parse requested endpoint from base path
		const endpoint = path.replace(this.BASE_PATH, '');

		// Handle root route
		if (endpoint === '' || endpoint === '/') {
			return this.jsonResponse({
				message: `Welcome to the STXCITY cache! Supported endpoints: ${this.SUPPORTED_PATHS.join(', ')}`,
			});
		}

		// handle unsupported endpoints
		const isSupported = this.SUPPORTED_PATHS.some(
			(path) =>
				endpoint === path || // exact match
				(path.endsWith('/') && endpoint.startsWith(path)) // prefix match for paths ending with /
		);

		if (!isSupported) {
			return this.jsonResponse(
				{
					error: `Unsupported endpoint: ${endpoint}`,
					supportedEndpoints: this.SUPPORTED_PATHS,
				},
				404
			);
		}

		// create cache key from endpoint
		const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;

		// handle /tokens/tradable-full-details-tokens path
		if (endpoint === '/tokens/tradable-full-details-tokens') {
			return this.fetchWithCache(endpoint, cacheKey);
		}

		// Return 404 for any other endpoint
		return this.jsonResponse(
			{
				error: `Unrecognized endpoint: ${endpoint}. Supported endpoints: ${this.SUPPORTED_PATHS.join(', ')}`,
			},
			404
		);
	}
}

import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { createJsonResponse } from '../utils';
import { getKnownAddresses } from '../utils/address-store';
import { RateLimitedFetcher } from '../rate-limiter';

/**
 * Durable Object class for the BNS API
 */
export class BnsApiDO extends DurableObject<Env> {
	private readonly CACHE_TTL: number;
	private readonly MAX_REQUESTS_PER_MINUTE: number;
	private readonly INTERVAL_MS: number;
	private readonly MAX_RETRIES: number;
	private readonly RETRY_DELAY: number;
	private readonly ALARM_INTERVAL_MS: number;
	private readonly BASE_API_URL: string = 'https://api.bns.xyz';
	private readonly BASE_PATH: string = '/bns';
	private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
	private readonly SUPPORTED_ENDPOINTS: string[] = ['/names/{address}'];
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
			// Get all unique addresses from KV cache
			const addresses = await getKnownAddresses(this.env);
			console.log(`BnsApiDO: updating ${addresses.length} known addresses`);

			// Track success/failure for each address
			const results = {
				success: 0,
				failed: 0,
				errors: [] as string[],
			};

			// Update BNS names for each address
			for (const address of addresses) {
				const endpoint = `/v2/names/${address}`;
				try {
					const cacheKey = `${this.CACHE_PREFIX}_names_${address}`;
					await this.fetchWithCache(endpoint, cacheKey);
					results.success++;
				} catch (error) {
					results.failed++;
					results.errors.push(
						`BnsApiDO: failed to update ${address} (${endpoint}): ${error instanceof Error ? error.message : String(error)}`
					);
					// Continue to next address on error
					continue;
				}
			}

			console.log(`Updated BNS cache for ${addresses.length} addresses`);

			const endTime = Date.now();
			const totalDuration = endTime - startTime;

			console.log(
				`BnsApiDO: ${addresses.length} addresses updated in ${totalDuration}ms, success: ${results.success}, failed: ${results.failed}`
			);
		} catch (error) {
			console.error(`BnsApiDO: alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Always schedule next alarm if one isn't set
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm === null) {
				this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
			}
		}
	}

	private async fetchWithCache(endpoint: string, cacheKey: string): Promise<Response> {
		return this.fetcher.fetch(endpoint, cacheKey);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (!path.startsWith(this.BASE_PATH)) {
			return createJsonResponse(
				{
					error: `Request at ${path} does not start with base path ${this.BASE_PATH}`,
				},
				404
			);
		}

		// Remove base path to get the endpoint
		const endpoint = path.replace(this.BASE_PATH, '');

		// Handle root path
		if (endpoint === '' || endpoint === '/') {
			return createJsonResponse({
				message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			});
		}

		// Handle name lookups
		if (endpoint.startsWith('/names/')) {
			const address = endpoint.replace('/names/', '');
			const cacheKey = `${this.CACHE_PREFIX}_names_${address}`;
			return this.fetchWithCache(`/v2/names/${address}`, cacheKey);
		}

		return createJsonResponse(
			{
				error: `Unsupported endpoint: ${endpoint}, supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			},
			404
		);
	}
}

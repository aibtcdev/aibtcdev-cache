import { Env } from '../../worker-configuration';
import { createSuccessResponse, createErrorResponse } from '../utils/requests-responses-util';
import { RequestQueue } from './request-queue-service';
import { TokenBucket } from './token-bucket-service';
import { CacheService } from './kv-cache-service';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { Logger } from '../utils/logger-util';

/**
 * Service that provides rate-limited API fetching capabilities
 * Handles caching, request queuing, and rate limiting for external API calls
 */
export class ApiRateLimiterService {
	private readonly cacheService: CacheService;
	private readonly requestQueue: RequestQueue<Response>;
	private readonly tokenBucket: TokenBucket;
	private windowRequests: number = 0;
	private lastRequestTime = 0;
	private readonly minRequestSpacing: number;

	/**
	 * Creates a new API rate limiter service
	 *
	 * @param env - The Cloudflare Worker environment
	 * @param baseApiUrl - The base URL for the external API
	 * @param cacheTtl - Time-to-live in seconds for cached API responses
	 * @param maxRequestsPerInterval - Maximum number of requests allowed in the interval
	 * @param intervalMs - The time interval in milliseconds for rate limiting
	 * @param maxRetries - Maximum number of times to retry a failed request
	 * @param retryDelay - Base delay in milliseconds between retries
	 */
	constructor(
		private readonly env: Env,
		private readonly baseApiUrl: string,
		private readonly cacheTtl: number,
		private readonly maxRequestsPerInterval: number,
		private readonly intervalMs: number,
		private readonly maxRetries: number,
		private readonly retryDelay: number
	) {
		this.cacheService = new CacheService(env, cacheTtl, false);
		this.tokenBucket = new TokenBucket(maxRequestsPerInterval, intervalMs);
		this.requestQueue = new RequestQueue<Response>(maxRequestsPerInterval, intervalMs, maxRetries, retryDelay);

		// Ensure at least 250ms between requests
		this.minRequestSpacing = Math.max(250, Math.floor(intervalMs / maxRequestsPerInterval));

		// Reset window requests counter every interval
		setInterval(() => {
			this.windowRequests = 0;
		}, this.intervalMs);
	}

	/**
	 * Returns the current length of the request queue
	 *
	 * @returns The number of requests currently in the queue
	 */
	public getQueueLength(): number {
		return this.requestQueue.getQueueLength();
	}

	/**
	 * Returns the current number of available tokens in the rate limiter
	 *
	 * @returns The number of tokens currently available
	 */
	public getTokenCount(): number {
		return this.tokenBucket.getAvailableTokens();
	}

	/**
	 * Returns the number of requests made in the current time window
	 *
	 * @returns The count of requests made in the current interval
	 */
	public getWindowRequestsCount(): number {
		return this.windowRequests;
	}

	/**
	 * Fetches data from an API endpoint with rate limiting and caching
	 *
	 * @param endpoint - The API endpoint path to fetch (will be appended to baseApiUrl)
	 * @param cacheKey - The key to use for caching the response
	 * @param bustCache - If true, bypass the cache and force a fresh request
	 * @returns A promise that resolves to the API response
	 */
	public async fetch(endpoint: string, cacheKey: string, bustCache = false): Promise<Response> {
		// Check cache first - bypass rate limiting for cached responses
		if (!bustCache) {
			const cached = await this.cacheService.get<string>(cacheKey);
			if (cached) {
				return createSuccessResponse(cached);
			}
		}

		// If not cached, go through rate limiting queue
		return this.requestQueue.enqueue(async () => {
			// Implement request spacing
			const now = Date.now();
			const timeSinceLastRequest = now - this.lastRequestTime;

			if (timeSinceLastRequest < this.minRequestSpacing) {
				await new Promise((resolve) => setTimeout(resolve, this.minRequestSpacing - timeSinceLastRequest));
			}

			// Make the actual request
			const response = await this.makeRequest(endpoint, cacheKey);
			this.lastRequestTime = Date.now();
			this.windowRequests++;

			return response;
		});
	}

	/**
	 * Makes the actual API request and handles caching the response
	 *
	 * @param endpoint - The API endpoint path to fetch
	 * @param cacheKey - The key to use for caching the response
	 * @returns A promise that resolves to the API response
	 * @throws Error if the request fails and should be retried
	 */
	private async makeRequest(endpoint: string, cacheKey: string): Promise<Response> {
		const logger = Logger.getInstance(this.env);
		logger.debug(`API request: ${url.toString()}`);

		// Separate the path from the base URL, if there is one
		const baseUrl = new URL(this.baseApiUrl);
		const basePath = baseUrl.pathname === '/' ? '' : baseUrl.pathname;
		const url = new URL(`${basePath}${endpoint}`, baseUrl.origin);

		// Make API request
		const startTime = Date.now();
		const response = await fetch(url);
		const duration = Date.now() - startTime;

		// Log slow responses
		if (duration > 1000) {
			logger.warn(`Slow API response: ${url.toString()}`, { 
				duration,
				threshold: 1000,
				endpoint
			});
		}

		if (response.status === 429) {
			throw new ApiError(ErrorCode.RATE_LIMIT_EXCEEDED, {
				retryAfter: response.headers.get('Retry-After') || '60',
			});
		}

		if (!response.ok) {
			const retryable = response.status >= 500;

			if (retryable) {
				// Will be retried by RequestQueue
				throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
					message: `${response.status}: ${response.statusText}`,
					url: url.toString(),
				});
			} else {
				// For 4xx errors, we don't want to retry
				return createErrorResponse(
					new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
						message: `API request failed: ${response.statusText}`,
						status: response.status,
					})
				);
			}
		}

		const data = await response.text();

		// Cache the successful response
		await this.cacheService.set(cacheKey, data);

		return createSuccessResponse(data, response.status);
	}
}

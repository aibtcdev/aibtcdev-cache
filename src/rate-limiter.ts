import { Env } from '../worker-configuration';

interface QueuedRequest {
	resolve: (value: Response | PromiseLike<Response>) => void;
	reject: (reason?: any) => void;
	endpoint: string;
	cacheKey: string;
	retryCount: number;
}

/**
 * A rate-limited fetcher implementation for Cloudflare Workers
 * that uses a token bucket approach with consistent request spacing
 */
export class RateLimitedFetcher {
	private queue: QueuedRequest[] = [];
	private processing = false;
	private lastRequestTime = 0;
	private tokens: number;
	private windowRequests: number = 0;
	private readonly minRequestSpacing: number;

	constructor(
		private readonly env: Env,
		private readonly baseApiUrl: string,
		private readonly cacheTtl: number,
		private readonly maxRequestsPerInterval: number,
		private readonly intervalMs: number,
		private readonly maxRetries: number,
		private readonly retryDelay: number
	) {
		this.tokens = maxRequestsPerInterval;
		// Ensure at least 100ms between requests
		this.minRequestSpacing = Math.max(100, Math.floor(intervalMs / maxRequestsPerInterval));

		// Start token replenishment
		this.startTokenReplenishment();
	}

	public getQueueLength(): number {
		return this.queue.length;
	}

	public getTokenCount(): number {
		return this.tokens;
	}

	public getWindowRequestsCount(): number {
		return this.windowRequests;
	}

	private startTokenReplenishment() {
		const replenishInterval = this.intervalMs / this.maxRequestsPerInterval;
		setInterval(() => {
			if (this.tokens < this.maxRequestsPerInterval) {
				this.tokens++;
				void this.processQueue();
			}
		}, replenishInterval);

		// Reset window requests counter every interval
		setInterval(() => {
			this.windowRequests = 0;
		}, this.intervalMs);
	}

	private async processQueue() {
		if (this.processing || this.queue.length === 0 || this.tokens <= 0) return;
		this.processing = true;

		try {
			while (this.queue.length > 0 && this.tokens > 0) {
				const now = Date.now();
				const timeSinceLastRequest = now - this.lastRequestTime;

				if (timeSinceLastRequest < this.minRequestSpacing) {
					await new Promise((resolve) => setTimeout(resolve, this.minRequestSpacing - timeSinceLastRequest));
				}

				const request = this.queue[0];
				const result = await this.processRequest(request);

				if (result.success) {
					this.queue.shift(); // Remove the request only if successful
					this.tokens--;
					this.lastRequestTime = Date.now();
					this.windowRequests++;
				} else if (result.retry && request.retryCount < this.maxRetries) {
					// Move to end of queue for retry
					this.queue.shift();
					request.retryCount++;
					this.queue.push(request);
					await new Promise((resolve) => setTimeout(resolve, this.retryDelay * request.retryCount));
				} else {
					// Max retries exceeded or non-retryable error
					this.queue.shift();
					request.reject(result.error);
				}
			}
		} finally {
			this.processing = false;

			// If there are still items in the queue and tokens available, continue processing
			if (this.queue.length > 0 && this.tokens > 0) {
				void this.processQueue();
			}
		}
	}

	private async processRequest(request: QueuedRequest): Promise<{ success: boolean; retry?: boolean; error?: Error }> {
		try {
			// Make API request (cache was already checked)
			const url = new URL(request.endpoint, this.baseApiUrl);
			const response = await fetch(url);

			if (response.status === 429) {
				return { success: false, retry: true, error: new Error('Rate limit exceeded, moving request to end of queue') };
			}

			if (!response.ok) {
				return {
					success: false,
					retry: response.status >= 500,
					error: new Error(`API request failed (${url}): ${response.statusText}`),
				};
			}

			const data = await response.text();
			await this.env.AIBTCDEV_CACHE_KV.put(request.cacheKey, data, { expirationTtl: this.cacheTtl });

			request.resolve(
				new Response(data, {
					headers: { 'Content-Type': 'application/json' },
				})
			);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				retry: true,
				error: error instanceof Error ? error : new Error('Unknown error occurred'),
			};
		}
	}

	/**
	 * Enqueues a fetch request with rate limiting
	 */
	public async fetch(endpoint: string, cacheKey: string): Promise<Response> {
		// Check cache first - bypass rate limiting for cached responses
		const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);
		if (cached) {
			return new Response(cached, {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// If not cached, go through rate limiting queue
		return new Promise((resolve, reject) => {
			this.queue.push({ resolve, reject, endpoint, cacheKey, retryCount: 0 });
			void this.processQueue();
		});
	}
}

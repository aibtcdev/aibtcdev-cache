import { Env } from '../worker-configuration';

/**
 * A rate-limited fetcher implementation for Cloudflare Workers
 * that uses a rolling window approach rather than setTimeout
 */
export class RateLimitedFetcher {
	public getQueueLength(): number {
		return this.queue.length;
	}

	public getWindowRequestsCount(): number {
		const now = Date.now();
		return this.requestTimes.filter((time) => now - time < this.intervalMs).length;
	}

	private queue: Array<{
		resolve: (value: Response | PromiseLike<Response>) => void;
		reject: (reason?: any) => void;
		endpoint: string;
		cacheKey: string;
	}> = [];
	private requestTimes: number[] = [];
	private processing = false;

	constructor(
		private readonly maxRequestsPerInterval: number,
		private readonly intervalMs: number,
		private readonly env: Env,
		private readonly baseApiUrl: string,
		private readonly cacheTtl: number
	) {}

	/**
	 * Processes the queue of requests while respecting rate limits
	 */
	private async processQueue() {
		if (this.processing) return;
		this.processing = true;

		while (this.queue.length > 0) {
			const now = Date.now();
			// Remove timestamps outside the current window
			this.requestTimes = this.requestTimes.filter((time) => now - time < this.intervalMs);

			// Check if we can make another request
			if (this.requestTimes.length < this.maxRequestsPerInterval) {
				const request = this.queue.shift();
				if (request) {
					try {
						// Add the current timestamp
						this.requestTimes.push(now);

						// Try to get from cache first
						const cached = await this.env.AIBTCDEV_CACHE_KV.get(request.cacheKey);
						if (cached) {
							request.resolve(
								new Response(cached, {
									headers: { 'Content-Type': 'application/json' },
								})
							);
							continue;
						}

						// Fetch from API if not in cache
						const url = new URL(request.endpoint, this.baseApiUrl);
						const response = await fetch(url);

						if (!response.ok) {
							throw new Error(`API request failed (${url}): ${response.statusText}`);
						}

						const data = await response.text();
						// Cache the successful response
						await this.env.AIBTCDEV_CACHE_KV.put(request.cacheKey, data, { expirationTtl: this.cacheTtl });

						request.resolve(
							new Response(data, {
								headers: { 'Content-Type': 'application/json' },
							})
						);
					} catch (error) {
						request.reject(error);
					}
				}
			} else {
				// If we can't make a request now, wait until the oldest request expires
				const oldestRequest = Math.min(...this.requestTimes);
				const waitTime = this.intervalMs - (now - oldestRequest);
				await new Promise((resolve) => setTimeout(resolve, waitTime));
			}
		}

		this.processing = false;
	}

	/**
	 * Enqueues a fetch request with rate limiting
	 */
	public async fetch(endpoint: string, cacheKey: string): Promise<Response> {
		return new Promise((resolve, reject) => {
			this.queue.push({ resolve, reject, endpoint, cacheKey });
			void this.processQueue();
		});
	}
}

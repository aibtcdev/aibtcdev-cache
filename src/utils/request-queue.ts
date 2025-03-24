import { TokenBucket } from './token-bucket';

interface QueuedRequest<T> {
	execute: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: any) => void;
	retryCount: number;
}

export class RequestQueue<T> {
	private queue: QueuedRequest<T>[] = [];
	private processing = false;
	private lastRequestTime = 0;
	private readonly minRequestSpacing: number;
	private readonly rateLimiter: TokenBucket;

	constructor(
		maxRequestsPerInterval: number,
		intervalMs: number,
		private readonly maxRetries: number,
		private readonly retryDelay: number
	) {
		this.rateLimiter = new TokenBucket(maxRequestsPerInterval, intervalMs);
		this.minRequestSpacing = Math.max(250, Math.floor(intervalMs / maxRequestsPerInterval));
	}

	public enqueue(execute: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push({
				execute,
				resolve,
				reject,
				retryCount: 0,
			});
			void this.processQueue();
		});
	}

	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0 || !this.rateLimiter.getToken()) {
			return;
		}

		this.processing = true;

		try {
			while (this.queue.length > 0 && this.rateLimiter.getAvailableTokens() > 0) {
				const now = Date.now();
				const timeSinceLastRequest = now - this.lastRequestTime;

				if (timeSinceLastRequest < this.minRequestSpacing) {
					await new Promise((resolve) => setTimeout(resolve, this.minRequestSpacing - timeSinceLastRequest));
				}

				const request = this.queue[0];

				try {
					const result = await request.execute();
					this.queue.shift();
					this.lastRequestTime = Date.now();
					request.resolve(result);
				} catch (error) {
					this.queue.shift();

					if (request.retryCount < this.maxRetries) {
						request.retryCount++;
						this.queue.push(request);
						await new Promise((resolve) => setTimeout(resolve, this.retryDelay * request.retryCount));
					} else {
						request.reject(error instanceof Error ? error : new Error(`Unknown error occurred ${String(error)}`));
					}
				}
			}
		} finally {
			this.processing = false;
			if (this.queue.length > 0 && this.rateLimiter.getAvailableTokens() > 0) {
				void this.processQueue();
			}
		}
	}
}

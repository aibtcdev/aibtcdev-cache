import { TokenBucket } from './token-bucket-service';
import { ApiError } from '../utils/api-error';
import { ErrorCode } from '../utils/error-catalog';
import { Logger } from '../utils/logger';

/**
 * Represents a request in the queue with its execution function and callbacks
 */
interface QueuedRequest<T> {
	execute: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: any) => void;
	retryCount: number;
}

/**
 * Manages a queue of requests with rate limiting and automatic retries
 * Uses a token bucket algorithm to control request rate
 *
 * @template T The type of response expected from the queued requests
 */
export class RequestQueue<T> {
	private queue: QueuedRequest<T>[] = [];
	private processing = false;
	private lastRequestTime = 0;
	private readonly minRequestSpacing: number;
	private readonly rateLimiter: TokenBucket;

	/**
	 * Creates a new request queue with rate limiting and retry capabilities
	 *
	 * @param maxRequestsPerInterval - Maximum number of requests allowed in the interval
	 * @param intervalMs - The time interval in milliseconds for rate limiting
	 * @param maxRetries - Maximum number of times to retry a failed request
	 * @param retryDelay - Base delay in milliseconds between retries (increases with each retry)
	 */
	constructor(
		maxRequestsPerInterval: number,
		intervalMs: number,
		private readonly maxRetries: number,
		private readonly retryDelay: number
	) {
		this.rateLimiter = new TokenBucket(maxRequestsPerInterval, intervalMs);
		this.minRequestSpacing = Math.max(250, Math.floor(intervalMs / maxRequestsPerInterval));
	}

	/**
	 * Returns the current length of the request queue
	 *
	 * @returns The number of requests currently in the queue
	 */
	public getQueueLength(): number {
		return this.queue.length;
	}

	/**
	 * Adds a request to the queue and returns a promise that resolves when the request completes
	 *
	 * @param execute - Function that executes the request and returns a promise
	 * @returns A promise that resolves with the result of the request or rejects with an error
	 */
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

	/**
	 * Processes the queue of requests, respecting rate limits and handling retries
	 * This method is called automatically when requests are enqueued
	 */
	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0 || !this.rateLimiter.getToken()) {
			return;
		}

		this.processing = true;

		try {
			while (this.queue.length > 0 && this.rateLimiter.getAvailableTokens() > 0) {
				const now = Date.now();
				const timeSinceLastRequest = now - this.lastRequestTime;

				// Ensure minimum spacing between requests
				if (timeSinceLastRequest < this.minRequestSpacing) {
					await new Promise((resolve) => setTimeout(resolve, this.minRequestSpacing - timeSinceLastRequest));
				}

				const request = this.queue[0];

				try {
					const startTime = Date.now();
					const result = await request.execute();
					const duration = Date.now() - startTime;

					// Log slow requests (over 1 second)
					if (duration > 1000) {
						Logger.getInstance().warn(`Slow queued request execution`, { duration });
					}

					this.queue.shift();
					this.lastRequestTime = Date.now();
					request.resolve(result);
				} catch (error) {
					this.queue.shift();

					// Implement exponential backoff for retries
					if (request.retryCount < this.maxRetries) {
						request.retryCount++;
						this.queue.push(request);
						const retryDelay = this.retryDelay * request.retryCount;

						Logger.getInstance().info(`Retrying request`, {
							attempt: request.retryCount,
							maxRetries: this.maxRetries,
							retryDelay,
						});

						await new Promise((resolve) => setTimeout(resolve, retryDelay));
					} else {
						// If it's already an ApiError, pass it through
						if (error instanceof ApiError) {
							request.reject(error);
						} else {
							// Otherwise, wrap in an ApiError
							const apiError = new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
								message: error instanceof Error ? error.message : String(error),
							});
							Logger.getInstance().error(
								`Request failed after ${this.maxRetries} retries`,
								error instanceof Error ? error : new Error(String(error))
							);
							request.reject(apiError);
						}
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

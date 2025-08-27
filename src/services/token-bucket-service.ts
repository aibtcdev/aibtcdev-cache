/**
 * Implements a token bucket algorithm for rate limiting
 * Tokens are automatically refilled over time based on the configured rate
 */
export class TokenBucket {
	private tokens: number;
	private lastRefillTime: number;
	private readonly maxTokens: number;
	private readonly refillRate: number; // tokens per millisecond
	private readonly env?: Env;

	/**
	 * Creates a new token bucket for rate limiting
	 *
	 * @param maxTokens - Maximum number of tokens the bucket can hold
	 * @param refillIntervalMs - Time in milliseconds to completely refill the bucket
	 * @param env - Optional Cloudflare Worker environment for logging
	 */
	constructor(maxTokens: number, refillIntervalMs: number, env?: Env) {
		this.tokens = maxTokens;
		this.maxTokens = maxTokens;
		this.refillRate = maxTokens / refillIntervalMs;
		this.lastRefillTime = Date.now();
		this.env = env;
	}

	/**
	 * Attempts to get a token from the bucket
	 *
	 * @returns True if a token was available and consumed, false otherwise
	 */
	public getToken(): boolean {
		this.refill();
		if (this.tokens >= 1) {
			this.tokens -= 1;
			return true;
		}
		return false;
	}

	/**
	 * Gets the current number of available tokens
	 *
	 * @returns The number of tokens currently available
	 */
	public getAvailableTokens(): number {
		this.refill();
		return this.tokens;
	}

	/**
	 * Refills the token bucket based on elapsed time
	 * Called automatically when tokens are requested
	 */
	private refill(): void {
		const now = Date.now();
		const elapsedTime = now - this.lastRefillTime;
		const tokensToAdd = elapsedTime * this.refillRate;

		if (tokensToAdd > 0) {
			this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
			this.lastRefillTime = now;
		}
	}

	/**
	 * Syncs the token bucket state from Hiro API response headers
	 *
	 * @param headers - The response headers from the API call
	 */
	public syncFromHeaders(headers: Headers): void {
		const logger = this.env ? Logger.getInstance(this.env) : Logger.getInstance();

		const remainingStr = headers.get('x-ratelimit-remaining-stacks-minute');
		if (remainingStr) {
			const remaining = parseInt(remainingStr, 10);
			if (!isNaN(remaining)) {
				this.tokens = Math.min(this.tokens, remaining);
				logger.debug(`Synced tokens from headers`, { remaining, currentTokens: this.tokens });
			}
		}

		const retryAfterStr = headers.get('retry-after');
		if (retryAfterStr) {
			const retryAfter = parseInt(retryAfterStr, 10);
			if (!isNaN(retryAfter)) {
				this.lastRefillTime = Date.now() + retryAfter * 1000;
				logger.info(`Rate limit retry-after applied`, { retryAfter });
			}
		}
	}
}

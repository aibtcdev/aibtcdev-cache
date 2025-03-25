/**
 * Implements a token bucket algorithm for rate limiting
 * Tokens are automatically refilled over time based on the configured rate
 */
export class TokenBucket {
	private tokens: number;
	private lastRefillTime: number;
	private readonly maxTokens: number;
	private readonly refillRate: number; // tokens per millisecond

	/**
	 * Creates a new token bucket for rate limiting
	 *
	 * @param maxTokens - Maximum number of tokens the bucket can hold
	 * @param refillIntervalMs - Time in milliseconds to completely refill the bucket
	 */
	constructor(maxTokens: number, refillIntervalMs: number) {
		this.tokens = maxTokens;
		this.maxTokens = maxTokens;
		this.refillRate = maxTokens / refillIntervalMs;
		this.lastRefillTime = Date.now();
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
}

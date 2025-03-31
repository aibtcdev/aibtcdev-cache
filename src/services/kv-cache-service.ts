import { Env } from '../../worker-configuration';
import { stringifyWithBigInt } from '../utils/requests-responses-util';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { Logger } from '../utils/logger-util';

/**
 * Service for caching data in Cloudflare KV storage
 * Handles serialization/deserialization and TTL management
 */
export class CacheService {
	/**
	 * Creates a new cache service instance
	 *
	 * @param env - The Cloudflare Worker environment with KV bindings
	 * @param defaultTtl - Default time-to-live in seconds for cached items
	 * @param ignoreTtl - If true, items will be cached indefinitely (no expiration)
	 */
	constructor(private readonly env: Env, private readonly defaultTtl: number, private readonly ignoreTtl: boolean) {}

	/**
	 * Retrieves a value from the cache
	 *
	 * @param key - The cache key to retrieve
	 * @returns The cached value (parsed from JSON) or null if not found
	 */
	async get<T>(key: string): Promise<T | null> {
		try {
			const cached = await this.env.AIBTCDEV_CACHE_KV.get(key);
			if (!cached) return null;

			// Parse the cached value with special handling for legacy BigInt values
			const parsed = JSON.parse(cached, (key, value) => {
				// Handle legacy BigInt values with 'n' suffix
				if (typeof value === 'string' && value.endsWith('n') && /^\d+n$/.test(value)) {
					return value.slice(0, -1); // Remove the 'n' suffix
				}
				return value;
			});

			return parsed as T;
		} catch (error) {
			const logger = Logger.getInstance(this.env);
			logger.error(`Cache error: Failed to get key ${key}`, error instanceof Error ? error : new Error(String(error)), {
				operation: 'get',
				cacheKey: key,
				errorType: error instanceof Error ? error.constructor.name : typeof error,
			});
			throw new ApiError(ErrorCode.CACHE_ERROR, {
				reason: `Failed to get cache key: ${key}`,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Stores a value in the cache
	 *
	 * @param key - The cache key to store the value under
	 * @param value - The value to cache (will be JSON stringified)
	 * @param ttl - Optional TTL in seconds (defaults to the service's defaultTtl)
	 *              If ttl is 0, the item will be cached indefinitely
	 */
	async set(key: string, value: unknown, ttl: number = this.defaultTtl): Promise<void> {
		// If ttl is 0 or ignoreTtl is true, cache indefinitely
		const shouldIgnoreTtl = this.ignoreTtl || ttl === 0;
		try {
			// Use stringifyWithBigInt to ensure consistent handling of BigInt values
			const serializedValue = typeof value === 'string' ? value : stringifyWithBigInt(value);

			await this.env.AIBTCDEV_CACHE_KV.put(key, serializedValue, {
				expirationTtl: shouldIgnoreTtl ? undefined : ttl,
			});
		} catch (error) {
			const logger = Logger.getInstance(this.env);
			logger.error(`Cache error: Failed to set key ${key}`, error instanceof Error ? error : new Error(String(error)), {
				operation: 'set',
				cacheKey: key,
				ttl: shouldIgnoreTtl ? 'indefinite' : ttl,
				errorType: error instanceof Error ? error.constructor.name : typeof error,
			});
			throw new ApiError(ErrorCode.CACHE_ERROR, {
				reason: `Failed to set cache key: ${key}`,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

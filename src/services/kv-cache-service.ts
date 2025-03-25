import { Env } from '../../worker-configuration';
import { stringifyWithBigInt } from '../utils/requests-responses-util';

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
		const cached = await this.env.AIBTCDEV_CACHE_KV.get(key);
		return cached ? (JSON.parse(cached) as T) : null;
	}

	/**
	 * Stores a value in the cache
	 * 
	 * @param key - The cache key to store the value under
	 * @param value - The value to cache (will be JSON stringified)
	 * @param ttl - Optional TTL in seconds (defaults to the service's defaultTtl)
	 */
	async set(key: string, value: unknown, ttl: number = this.defaultTtl): Promise<void> {
		await this.env.AIBTCDEV_CACHE_KV.put(key, typeof value === 'string' ? value : stringifyWithBigInt(value), {
			expirationTtl: this.ignoreTtl ? undefined : ttl,
		});
	}
}

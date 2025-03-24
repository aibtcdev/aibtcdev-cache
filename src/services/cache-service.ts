import { Env } from '../../worker-configuration';
import { stringifyWithBigInt } from '../utils/json-helpers';

export class CacheService {
	constructor(private readonly env: Env, private readonly defaultTtl: number) {}

	async get<T>(key: string): Promise<T | null> {
		const cached = await this.env.AIBTCDEV_CACHE_KV.get(key);
		return cached ? (JSON.parse(cached) as T) : null;
	}

	async set(key: string, value: unknown, ttl: number = this.defaultTtl): Promise<void> {
		await this.env.AIBTCDEV_CACHE_KV.put(key, typeof value === 'string' ? value : stringifyWithBigInt(value), { expirationTtl: ttl });
	}
}

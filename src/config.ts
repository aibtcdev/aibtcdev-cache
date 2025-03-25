import { Env } from '../worker-configuration';
import { ApiError } from './utils/api-error';
import { ErrorCode } from './utils/error-catalog';

/**
 * Singleton configuration class for the application
 *
 * Provides centralized access to configuration settings and environment variables
 */
export class AppConfig {
	private static instance: AppConfig;
	private env: Env;

	/**
	 * Private constructor to enforce singleton pattern
	 *
	 * @param env - The Cloudflare Worker environment
	 */
	private constructor(env: Env) {
		this.env = env;
	}

	/**
	 * Gets the singleton instance of AppConfig
	 *
	 * @param env - The Cloudflare Worker environment (required on first call)
	 * @returns The AppConfig singleton instance
	 * @throws Error if called without env before initialization
	 */
	public static getInstance(env?: Env): AppConfig {
		if (!AppConfig.instance && env) {
			AppConfig.instance = new AppConfig(env);
		} else if (!AppConfig.instance) {
			throw new ApiError(ErrorCode.CONFIG_ERROR, {
				reason: 'AppConfig must be initialized with environment variables first',
			});
		}
		return AppConfig.instance;
	}

	/**
	 * Returns the application configuration settings
	 *
	 * @returns Configuration object with all application settings
	 */
	public getConfig() {
		return {
			// supported services for API caching
			// each entry is a durable object that handles requests
			SUPPORTED_SERVICES: ['/bns', '/hiro-api', '/stx-city', '/supabase', '/contract-calls'],
			// VALUES BELOW CAN BE OVERRIDDEN BY DURABLE OBJECTS
			// default cache TTL used for KV
			CACHE_TTL: 900, // 15 minutes
			// default rate limiting settings
			MAX_REQUESTS_PER_INTERVAL: 30, // no more than 30 requests
			INTERVAL_MS: 15000, // in a span of 15 seconds
			MAX_RETRIES: 3, // max retries for failed fetches
			RETRY_DELAY: 1000, // multiplied by retry attempt number
			// how often to warm the cache, should be shorter than the cache TTL
			ALARM_INTERVAL_MS: 300000, // 5 minutes
			// environment variables
			SUPABASE_URL: this.env.SUPABASE_URL,
			SUPABASE_SERVICE_KEY: this.env.SUPABASE_SERVICE_KEY,
		};
	}
}

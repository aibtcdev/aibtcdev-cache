export const APP_CONFIG = {
	// supported services for API caching
	// each entry is a durable object that handles requests
	SUPPORTED_SERVICES: ['/hiro-api'],
	// VALUES BELOW CAN BE OVERRIDDEN BY DURABLE OBJECTS
	// default cache TTL used for KV
	CACHE_TTL: 300, // 5 minutes
	// default rate limiting settings
	MAX_REQUESTS_PER_INTERVAL: 60, // no more than 60 requests
	INTERVAL_MS: 60000, // in a span of 60 seconds
	MAX_RETRIES: 3, // max retries for failed fetches
	RETRY_DELAY: 1000, // 1s, multiplied by retry number
	// how often to warm the cache, should be shorter than the cache TTL
	ALARM_INTERVAL_MS: 180000, // 3 minutes
};

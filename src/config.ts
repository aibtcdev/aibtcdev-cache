export const APP_CONFIG = {
	CACHE_TTL: 300,
	SUPPORTED_SERVICES: ['/hiro-api'],
	MAX_REQUESTS_PER_MINUTE: 250, // Hiro rate limit is 500 requests so halving that
	INTERVAL_MS: 300000, // 5 minutes
};

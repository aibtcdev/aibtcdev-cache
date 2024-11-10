export const APP_CONFIG = {
	CACHE_TTL: 300,
	SUPPORTED_SERVICES: ['/hiro-api'],
	// in any sliding window of 15 seconds, no more than 100 requests are processed
	MAX_REQUESTS_PER_MINUTE: 100,
	INTERVAL_MS: 15000,
};

import { Env } from '../worker-configuration';
import { createJsonResponse } from './utils/requests-responses';
import { RequestQueue } from './utils/request-queue';
import { TokenBucket } from './utils/token-bucket';
import { CacheService } from './services/cache-service';

/**
 * A service that provides rate-limited API fetching capabilities
 */
export class ApiRateLimiterService {
    private readonly cacheService: CacheService;
    private readonly requestQueue: RequestQueue<Response>;
    private readonly tokenBucket: TokenBucket;
    private windowRequests: number = 0;
    private lastRequestTime = 0;
    private readonly minRequestSpacing: number;

    constructor(
        private readonly env: Env,
        private readonly baseApiUrl: string,
        private readonly cacheTtl: number,
        private readonly maxRequestsPerInterval: number,
        private readonly intervalMs: number,
        private readonly maxRetries: number,
        private readonly retryDelay: number
    ) {
        this.cacheService = new CacheService(env, cacheTtl, false);
        this.tokenBucket = new TokenBucket(maxRequestsPerInterval, intervalMs);
        this.requestQueue = new RequestQueue<Response>(
            maxRequestsPerInterval, 
            intervalMs, 
            maxRetries, 
            retryDelay
        );
        
        // Ensure at least 250ms between requests
        this.minRequestSpacing = Math.max(250, Math.floor(intervalMs / maxRequestsPerInterval));
        
        // Reset window requests counter every interval
        setInterval(() => {
            this.windowRequests = 0;
        }, this.intervalMs);
    }

    /**
     * Returns the current length of the request queue
     */
    public getQueueLength(): number {
        return this.requestQueue.getQueueLength();
    }

    /**
     * Returns the current number of available tokens
     */
    public getTokenCount(): number {
        return this.tokenBucket.getAvailableTokens();
    }

    /**
     * Returns the number of requests made in the current window
     */
    public getWindowRequestsCount(): number {
        return this.windowRequests;
    }

    /**
     * Fetches data from an API endpoint with rate limiting and caching
     */
    public async fetch(endpoint: string, cacheKey: string, bustCache = false): Promise<Response> {
        // Check cache first - bypass rate limiting for cached responses
        if (!bustCache) {
            const cached = await this.cacheService.get<string>(cacheKey);
            if (cached) {
                return createJsonResponse(cached);
            }
        }

        // If not cached, go through rate limiting queue
        return this.requestQueue.enqueue(async () => {
            // Implement request spacing
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < this.minRequestSpacing) {
                await new Promise((resolve) => 
                    setTimeout(resolve, this.minRequestSpacing - timeSinceLastRequest)
                );
            }
            
            // Make the actual request
            const response = await this.makeRequest(endpoint, cacheKey);
            this.lastRequestTime = Date.now();
            this.windowRequests++;
            
            return response;
        });
    }

    /**
     * Makes the actual API request and handles caching the response
     */
    private async makeRequest(endpoint: string, cacheKey: string): Promise<Response> {
        // Separate the path from the base URL, if there is one
        const baseUrl = new URL(this.baseApiUrl);
        const basePath = baseUrl.pathname === '/' ? '' : baseUrl.pathname;
        const url = new URL(`${basePath}${endpoint}`, baseUrl.origin);
        
        // Make API request
        const response = await fetch(url);

        if (response.status === 429) {
            throw new Error('Rate limit exceeded, retrying later');
        }

        if (!response.ok) {
            const retryable = response.status >= 500;
            const error = new Error(`API request failed (${url}): ${response.statusText}`);
            if (retryable) {
                throw error; // Will be retried by RequestQueue
            } else {
                // For 4xx errors, we don't want to retry
                return createJsonResponse(
                    { error: `API request failed: ${response.statusText}` },
                    response.status
                );
            }
        }

        const data = await response.text();
        
        // Cache the successful response
        await this.cacheService.set(cacheKey, data);

        return createJsonResponse(data, response.status);
    }
}

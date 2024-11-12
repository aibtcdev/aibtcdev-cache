import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { APP_CONFIG } from '../config';
import { RateLimitedFetcher } from '../rate-limiter';

/**
 * Durable Object class for the BNS API
 */
export class BnsApiDO extends DurableObject<Env> {
    private readonly CACHE_TTL: number = APP_CONFIG.BNS_CACHE_TTL;
    private readonly MAX_REQUESTS_PER_MINUTE = APP_CONFIG.MAX_REQUESTS_PER_INTERVAL;
    private readonly INTERVAL_MS = APP_CONFIG.INTERVAL_MS;
    private readonly MAX_RETRIES = APP_CONFIG.MAX_RETRIES;
    private readonly RETRY_DELAY = APP_CONFIG.RETRY_DELAY;
    private readonly ALARM_INTERVAL_MS = APP_CONFIG.ALARM_INTERVAL_MS;
    private readonly BASE_API_URL: string = APP_CONFIG.BNS_API_URL;
    private readonly BASE_PATH: string = '/bns';
    private fetcher: RateLimitedFetcher;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        this.fetcher = new RateLimitedFetcher(
            this.env,
            this.BASE_API_URL,
            this.CACHE_TTL,
            this.MAX_REQUESTS_PER_MINUTE,
            this.INTERVAL_MS,
            this.MAX_RETRIES,
            this.RETRY_DELAY
        );

        // Set up alarm to run at configured interval
        ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
    }

    async alarm(): Promise<void> {
        // Get all unique addresses from KV cache
        const addresses = await this.extractAddressesFromKV();

        // Update BNS names for each address
        for (const address of addresses) {
            const endpoint = `/v2/names/${address}`;
            const cacheKey = `bns_${address}`;
            await this.fetchWithCache(endpoint, cacheKey);
        }

        console.log(`Updated BNS cache for ${addresses.length} addresses`);

        // Schedule next alarm
        this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
    }

    private async extractAddressesFromKV(): Promise<string[]> {
        const addresses = new Set<string>();
        let cursor: string | null = null;

        do {
            const result: KVNamespaceListResult<string, string> = await this.env.AIBTCDEV_CACHE_KV.list({ cursor });
            if (result.list_complete === false && result.cursor) {
                cursor = result.cursor;
            } else {
                cursor = null;
            }

            for (const key of result.keys) {
                // Look for keys matching address pattern
                const match = key.name.match(/hiro_api_extended_v1_address_([A-Z0-9]+)_(assets|balances)/);
                if (match) {
                    addresses.add(match[1]);
                }
            }
        } while (cursor != null);

        return Array.from(addresses);
    }

    private async fetchWithCache(endpoint: string, cacheKey: string): Promise<Response> {
        return this.fetcher.fetch(endpoint, cacheKey);
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        if (!path.startsWith(this.BASE_PATH)) {
            return new Response(
                JSON.stringify({
                    error: `Unrecognized path passed to BnsApiDO: ${path}`,
                }),
                {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        // Remove base path to get the endpoint
        const endpoint = path.replace(this.BASE_PATH, '');

        // Handle root path
        if (endpoint === '' || endpoint === '/') {
            return new Response(
                JSON.stringify({
                    message: 'BNS API cache endpoint',
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        // Handle name lookups
        if (endpoint.startsWith('/names/')) {
            const address = endpoint.replace('/names/', '');
            const cacheKey = `bns_${address}`;
            return this.fetchWithCache(`/v2/names/${address}`, cacheKey);
        }

        return new Response(
            JSON.stringify({
                error: 'Invalid endpoint',
            }),
            {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
}

import { DurableObject } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../../worker-configuration';
import { APP_CONFIG } from '../config';

/**
 * Durable Object class for Supabase queries
 */
export class SupabaseDO extends DurableObject<Env> {
    private readonly CACHE_TTL: number = APP_CONFIG.CACHE_TTL;
    private readonly ALARM_INTERVAL_MS = 60000; // 1 minute
    private readonly BASE_PATH: string = '/supabase';
    private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
    private readonly SUPPORTED_PATHS: string[] = ['/stats'];

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;

        // Set up alarm to run at configured interval
        ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
    }

    async alarm(): Promise<void> {
        const startTime = Date.now();
        try {
            // TODO: Implement Supabase query and cache update
            console.log('Updating Supabase stats cache...');
            
            const endTime = Date.now();
            console.log(`supabase-do: alarm executed in ${endTime - startTime}ms`);
        } catch (error) {
            console.error(`Alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            // Schedule next alarm
            this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
        }
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // Schedule next alarm if one isn't set
        const currentAlarm = await this.ctx.storage.getAlarm();
        if (currentAlarm === null) {
            this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
        }

        // Handle requests that don't match the base path
        if (!path.startsWith(this.BASE_PATH)) {
            return new Response(
                JSON.stringify({
                    error: `Unrecognized path passed to SupabaseDO: ${path}`,
                }),
                {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        // Parse requested endpoint from base path
        const endpoint = path.replace(this.BASE_PATH, '');

        // Handle root route
        if (endpoint === '' || endpoint === '/') {
            return new Response(
                JSON.stringify({
                    message: `Welcome to the Supabase cache! Supported endpoints: ${this.SUPPORTED_PATHS.join(', ')}`,
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        // Handle /stats endpoint
        if (endpoint === '/stats') {
            const cacheKey = `${this.CACHE_PREFIX}_stats`;
            const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);
            
            if (cached) {
                return new Response(cached, {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // TODO: Implement actual Supabase query here
            const mockData = {
                timestamp: new Date().toISOString(),
                message: 'Stats endpoint placeholder - implement Supabase query',
            };

            const data = JSON.stringify(mockData);
            await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, data, { 
                expirationTtl: this.CACHE_TTL 
            });

            return new Response(data, {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Return 404 for any other endpoint
        return new Response(
            JSON.stringify({
                error: `Unrecognized endpoint: ${endpoint}. Supported endpoints: ${this.SUPPORTED_PATHS.join(', ')}`,
            }),
            {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
}
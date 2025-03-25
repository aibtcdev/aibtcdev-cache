import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createJsonResponse } from '../utils/requests-responses-util';

interface StatsResponse {
	total_jobs: number;
	main_chat_jobs: number;
	individual_crew_jobs: number;
	top_profile_stacks_addresses: string[];
	top_crew_names: string[];
}

/**
 * Durable Object class for Supabase queries
 */
export class SupabaseDO extends DurableObject<Env> {
	private readonly CACHE_TTL: number;
	private readonly ALARM_INTERVAL_MS = 60000; // 1 minute
	private readonly BASE_PATH: string = '/supabase';
	private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
	private readonly SUPPORTED_ENDPOINTS: string[] = ['/stats'];
	private supabase: SupabaseClient;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx = ctx;
		this.env = env;

		// Initialize AppConfig with environment
		const config = AppConfig.getInstance(env).getConfig();

		// Set configuration values
		this.CACHE_TTL = config.CACHE_TTL;

		// Initialize Supabase client with config values
		this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
			auth: {
				persistSession: false,
			},
		});

		// Set up alarm to run at configured interval
		// ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

	private async fetchStats(): Promise<StatsResponse | undefined> {
		try {
			const { data, error } = await this.supabase
				.rpc('get_stats', undefined, {
					count: 'exact',
				})
				.select('*')
				.maybeSingle();

			if (error) {
				console.error('Error fetching stats:', error);
				return undefined;
			}

			if (!data) {
				console.error('No stats data returned from database');
				return undefined;
			}

			return data;
		} catch (err) {
			console.error('Exception in fetchStats:', err);
			return undefined;
		}
	}

	async alarm(): Promise<void> {
		const startTime = Date.now();
		try {
			console.log('SupabaseDO: updating cached database queries');

			const stats = await this.fetchStats();
			if (!stats) {
				console.error('SupabaseDO: failed to fetch stats from Supabase');
				return;
			}
			const data = JSON.stringify({
				timestamp: new Date().toISOString(),
				...stats,
			});

			const cacheKey = `${this.CACHE_PREFIX}_stats`;
			await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, data, {
				expirationTtl: this.CACHE_TTL,
			});

			const endTime = Date.now();
			const totalDuration = endTime - startTime;
			console.log(`SupabaseDO: cache updated in ${totalDuration}ms`);
		} catch (error) {
			console.error(`SupabaseDO: alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Schedule next alarm
			// this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
		}
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Schedule next alarm if one isn't set
		const currentAlarm = await this.ctx.storage.getAlarm();
		if (currentAlarm === null) {
			// this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
		}

		// Handle requests that don't match the base path
		if (!path.startsWith(this.BASE_PATH)) {
			return createJsonResponse(
				{
					error: `Request at ${path} does not start with base path ${this.BASE_PATH}`,
				},
				404
			);
		}

		// Parse requested endpoint from base path
		const endpoint = path.replace(this.BASE_PATH, '');

		// Handle root route
		if (endpoint === '' || endpoint === '/') {
			return createJsonResponse({
				message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			});
		}

		// handle unsupported endpoints
		const isSupported = this.SUPPORTED_ENDPOINTS.some(
			(path) =>
				endpoint === path || // exact match
				(path.endsWith('/') && endpoint.startsWith(path)) // prefix match for paths ending with /
		);

		if (!isSupported) {
			return createJsonResponse(
				{
					error: `Unsupported endpoint: ${endpoint}, supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
				},
				404
			);
		}

		// create cache key from endpoint
		const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;

		// Handle /stats endpoint
		if (endpoint === '/stats') {
			const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);

			if (cached) {
				return createJsonResponse(cached);
			}

			const stats = await this.fetchStats();
			// verify that stats were fetched
			if (!stats) {
				return createJsonResponse(
					{
						error: 'Failed to fetch stats from Supabase',
					},
					500
				);
			}

			// format the data, store it, and return it
			const data = JSON.stringify({
				timestamp: new Date().toISOString(),
				...stats,
			});
			await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, data, {
				expirationTtl: this.CACHE_TTL,
			});

			return createJsonResponse(data);
		}

		// Return 404 for any other endpoint
		return createJsonResponse(
			{
				error: `Unsupported endpoint: ${endpoint}, supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			},
			404
		);
	}
}

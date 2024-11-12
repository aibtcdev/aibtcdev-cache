import { DurableObject } from 'cloudflare:workers';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';

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
	private readonly SUPPORTED_PATHS: string[] = ['/stats'];
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
				persistSession: false
			}
		});

		// Set up alarm to run at configured interval
		ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

	private async fetchStats(): Promise<StatsResponse | undefined> {
		try {
			const { data, error } = await this.supabase
				.rpc('get_stats')
				.returns<StatsResponse>()
				.single();

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
			console.log('Updating Supabase stats cache...');

			const stats = await this.fetchStats();
			if (!stats) {
				console.error('Failed to fetch stats from Supabase');
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

			const stats = await this.fetchStats();
			// verify that stats were fetched
			if (!stats) {
				return new Response(
					JSON.stringify({
						error: 'Failed to fetch stats from Supabase',
					}),
					{
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}
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

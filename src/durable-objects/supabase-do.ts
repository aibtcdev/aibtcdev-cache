import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createJsonResponse } from '../utils/requests-responses-util';
import { ApiError } from '../utils/api-error';
import { ErrorCode } from '../utils/error-catalog';
import { handleRequest } from '../utils/request-handler';

/**
 * Interface for statistics response from Supabase
 * 
 * Contains various counts and top items from the database.
 */
interface StatsResponse {
	total_jobs: number;
	main_chat_jobs: number;
	individual_crew_jobs: number;
	top_profile_stacks_addresses: string[];
	top_crew_names: string[];
}

/**
 * Durable Object class for handling Supabase database queries
 * 
 * This Durable Object provides a cached interface to Supabase database,
 * which stores application data. It handles:
 * 
 * 1. Executing database queries using the Supabase client
 * 2. Caching query results to reduce database load
 * 3. Periodically refreshing cached data
 * 4. Providing endpoints for statistics and other database information
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

	/**
	 * Fetches statistics from the Supabase database
	 * 
	 * This method calls a stored procedure in the database to retrieve
	 * various statistics about the application's data.
	 * 
	 * @returns A promise that resolves to the statistics or undefined if the query fails
	 */
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

	/**
	 * Alarm handler that periodically updates cached database queries
	 * 
	 * This method:
	 * 1. Fetches fresh statistics from the database
	 * 2. Updates the cache with the new data
	 * 3. Logs information about the update process
	 * 
	 * @returns A promise that resolves when the alarm handler completes
	 */
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

	/**
	 * Main request handler for the Supabase Durable Object
	 * 
	 * Handles the following endpoints:
	 * - / - Returns a list of supported endpoints
	 * - /stats - Returns statistics from the database
	 * 
	 * @param request - The incoming HTTP request
	 * @returns A Response object with the requested data or an error message
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Schedule next alarm if one isn't set
		const currentAlarm = await this.ctx.storage.getAlarm();
		if (currentAlarm === null) {
			// this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
		}

		return handleRequest(async () => {
			// Handle requests that don't match the base path
			if (!path.startsWith(this.BASE_PATH)) {
				throw new ApiError(ErrorCode.NOT_FOUND, { 
					resource: path,
					basePath: this.BASE_PATH
				});
			}

			// Parse requested endpoint from base path
			const endpoint = path.replace(this.BASE_PATH, '');

			// Handle root route
			if (endpoint === '' || endpoint === '/') {
				return {
					message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
				};
			}

			// handle unsupported endpoints
			const isSupported = this.SUPPORTED_ENDPOINTS.some(
				(path) =>
					endpoint === path || // exact match
					(path.endsWith('/') && endpoint.startsWith(path)) // prefix match for paths ending with /
			);

			if (!isSupported) {
				throw new ApiError(ErrorCode.NOT_FOUND, {
					resource: endpoint,
					supportedEndpoints: this.SUPPORTED_ENDPOINTS
				});
			}

			// create cache key from endpoint
			const cacheKey = `${this.CACHE_PREFIX}${endpoint.replaceAll('/', '_')}`;

			// Handle /stats endpoint
			if (endpoint === '/stats') {
				const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);

				if (cached) {
					return JSON.parse(cached);
				}

				const stats = await this.fetchStats();
				// verify that stats were fetched
				if (!stats) {
					throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
						message: 'Failed to fetch stats from Supabase'
					});
				}

				// format the data, store it, and return it
				const data = {
					timestamp: new Date().toISOString(),
					...stats,
				};
				
				await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, JSON.stringify(data), {
					expirationTtl: this.CACHE_TTL,
				});

				return data;
			}

			// This should never happen due to the isSupported check above
			throw new ApiError(ErrorCode.NOT_FOUND, {
				resource: endpoint,
				supportedEndpoints: this.SUPPORTED_ENDPOINTS
			});
		}, this.env, {
			slowThreshold: 3000 // Database operations can be slow, so set a higher threshold (3 seconds)
		});
	}
}

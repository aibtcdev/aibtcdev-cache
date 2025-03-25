import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { validateStacksAddress } from '@stacks/transactions';
import { createSuccessResponse, createErrorResponse } from '../utils/requests-responses-util';
import { getKnownAddresses } from '../utils/address-store-util';
import { getNameFromAddress, initStacksFetcher } from '../utils/bns-v2-util';
import { ApiError } from '../utils/api-error';
import { ErrorCode } from '../utils/error-catalog';
import { handleRequest } from '../utils/request-handler';

/**
 * Durable Object class for the BNS (Blockchain Naming System) API
 *
 * This Durable Object handles BNS name lookups for Stacks addresses.
 * It provides endpoints to retrieve BNS names associated with Stacks addresses
 * and maintains a cache of these associations to reduce API calls.
 */
export class BnsApiDO extends DurableObject<Env> {
	private readonly CACHE_TTL: number;
	// private readonly ALARM_INTERVAL_MS: number;
	private readonly ALARM_INTERVAL_MS = 600000; // 10 minutes
	private readonly BASE_PATH: string = '/bns';
	private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
	private readonly SUPPORTED_ENDPOINTS: string[] = ['/names/{address}'];

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx = ctx;
		this.env = env;

		// Initialize AppConfig with environment
		const config = AppConfig.getInstance(env).getConfig();
		this.CACHE_TTL = config.CACHE_TTL;
		// this.ALARM_INTERVAL_MS = config.ALARM_INTERVAL_MS;

		// Initialize the Stacks contract fetcher
		initStacksFetcher(env);

		// Set up alarm to run at configured interval
		// ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

	/**
	 * Alarm handler that periodically updates the BNS name cache
	 *
	 * This method is triggered by the Durable Object's alarm system and:
	 * 1. Retrieves all known Stacks addresses from KV storage
	 * 2. Updates the BNS name for each address
	 * 3. Stores the results in KV cache with the configured TTL
	 * 4. Logs statistics about the update process
	 *
	 * @returns A promise that resolves when the alarm handler completes
	 */
	async alarm(): Promise<void> {
		const startTime = Date.now();
		try {
			// Get all unique addresses from KV cache
			const addresses = await getKnownAddresses(this.env);
			console.log(`BnsApiDO: updating ${addresses.length} known addresses`);

			// Track success/failure for each address
			const results = {
				success: 0,
				failed: 0,
				errors: [] as string[],
			};

			// Update BNS names for each address
			for (const address of addresses) {
				try {
					const name = await getNameFromAddress(address);
					const cacheKey = `${this.CACHE_PREFIX}_names_${address}`;
					await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, name, { expirationTtl: this.CACHE_TTL });
					results.success++;
				} catch (error) {
					results.failed++;
					results.errors.push(`BnsApiDO: failed to update ${address}: ${error instanceof Error ? error.message : String(error)}`);
					continue;
				}
			}

			const endTime = Date.now();
			const totalDuration = endTime - startTime;
			const errors = results.errors.length > 0 ? results.errors.join(', ') : 'none';

			console.log(
				`BnsApiDO: ${addresses.length} addresses updated in ${totalDuration}ms, success: ${results.success}, failed: ${results.failed}, errors: ${errors}`
			);
		} catch (error) {
			console.error(`BnsApiDO: alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Always schedule next alarm if one isn't set
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm === null) {
				// this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
			}
		}
	}

	/**
	 * Main request handler for the BNS API Durable Object
	 *
	 * Handles the following endpoints:
	 * - / - Returns a list of supported endpoints
	 * - /names/{address} - Returns the BNS name for the given Stacks address
	 *
	 * @param request - The incoming HTTP request
	 * @returns A Response object with the requested data or an error message
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		return handleRequest(
			async () => {
				if (!path.startsWith(this.BASE_PATH)) {
					throw new ApiError(ErrorCode.NOT_FOUND, {
						resource: path,
						basePath: this.BASE_PATH,
					});
				}

				// Remove base path to get the endpoint
				const endpoint = path.replace(this.BASE_PATH, '');

				// Handle root path
				if (endpoint === '' || endpoint === '/') {
					return {
						message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
					};
				}

				if (endpoint === '/names') {
					return {
						message: `Please provide an address to look up the name for, e.g. /names/SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF`,
					};
				}

				// Handle name lookups
				if (endpoint.startsWith('/names/')) {
					const address = endpoint.replace('/names/', '');
					const validAddress = validateStacksAddress(address);
					if (!validAddress) {
						throw new ApiError(ErrorCode.INVALID_REQUEST, {
							reason: `Invalid address ${address}, valid Stacks address required`,
						});
					}

					const cacheKey = `${this.CACHE_PREFIX}_names_${address}`;
					const cachedName = await this.env.AIBTCDEV_CACHE_KV.get<string>(cacheKey);
					if (cachedName) {
						return cachedName;
					}

					const name = await getNameFromAddress(address);

					if (name === '') {
						throw new ApiError(ErrorCode.NOT_FOUND, {
							resource: `name for address ${address}`,
							reason: 'No registered name found',
						});
					}

					await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, name, { expirationTtl: this.CACHE_TTL });
					return name;
				}

				throw new ApiError(ErrorCode.NOT_FOUND, {
					resource: endpoint,
					supportedEndpoints: this.SUPPORTED_ENDPOINTS,
				});
			},
			this.env,
			{
				slowThreshold: 2000, // BNS lookups can be slow
			}
		);
	}
}

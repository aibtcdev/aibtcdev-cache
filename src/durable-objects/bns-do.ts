import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { createJsonResponse } from '../utils/requests-responses';
import { getKnownAddresses } from '../utils/address-store';
import { getNameFromAddress, initStacksFetcher } from '../utils/bns-v2';
import { validateStacksAddress } from '@stacks/transactions';

/**
 * Durable Object class for the BNS API
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
		ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
	}

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
				this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
			}
		}
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (!path.startsWith(this.BASE_PATH)) {
			return createJsonResponse(
				{
					error: `Request at ${path} does not start with base path ${this.BASE_PATH}`,
				},
				404
			);
		}

		// Remove base path to get the endpoint
		const endpoint = path.replace(this.BASE_PATH, '');

		// Handle root path
		if (endpoint === '' || endpoint === '/') {
			return createJsonResponse({
				message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			});
		}

		if (endpoint === '/names') {
			return createJsonResponse({
				message: `Please provide an address to look up the name for, e.g. /names/SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF`,
			});
		}

		// Handle name lookups
		if (endpoint.startsWith('/names/')) {
			const address = endpoint.replace('/names/', '');
			const validAddress = validateStacksAddress(address);
			if (!validAddress) {
				return createJsonResponse({ error: `Invalid address ${address}, valid Stacks address required` }, 400);
			}
			const cacheKey = `${this.CACHE_PREFIX}_names_${address}`;
			const cachedName = await this.env.AIBTCDEV_CACHE_KV.get<string>(cacheKey);
			if (cachedName) {
				return createJsonResponse(cachedName);
			}
			const name = await getNameFromAddress(address);

			if (name === '') {
				return createJsonResponse(
					{
						error: `No registered name found for address ${address}`,
					},
					404
				);
			}

			await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, name, { expirationTtl: this.CACHE_TTL });
			return createJsonResponse(name);
		}

		return createJsonResponse(
			{
				error: `Unsupported endpoint: ${endpoint}, supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
			},
			404
		);
	}
}

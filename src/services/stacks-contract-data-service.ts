import { ClarityValue } from '@stacks/transactions';
import { Env } from '../../worker-configuration';
import { CacheService } from './kv-cache-service';
import { StacksApiService } from './stacks-api-service';
import { RequestQueue } from './request-queue-service';
import { ApiError } from '../utils/api-error';
import { ErrorCode } from '../utils/error-catalog';
import { Logger } from '../utils/logger';

/**
 * Service for fetching data from Stacks smart contracts
 * Handles caching, rate limiting, and retries for contract calls
 */
export class StacksContractFetcher {
	private readonly cacheService: CacheService;
	private readonly stacksApiService: StacksApiService;
	private readonly requestQueue: RequestQueue<ClarityValue>;

	/**
	 * Creates a new Stacks contract fetcher
	 *
	 * @param env - The Cloudflare Worker environment
	 * @param cacheTtl - Time-to-live in seconds for cached contract responses
	 * @param maxRequestsPerInterval - Maximum number of requests allowed in the interval
	 * @param intervalMs - The time interval in milliseconds for rate limiting
	 * @param maxRetries - Maximum number of times to retry a failed request
	 * @param retryDelay - Base delay in milliseconds between retries
	 */
	constructor(
		private readonly env: Env,
		private readonly cacheTtl: number,
		maxRequestsPerInterval: number,
		intervalMs: number,
		maxRetries: number,
		retryDelay: number
	) {
		this.cacheService = new CacheService(env, cacheTtl, false);
		this.stacksApiService = new StacksApiService();
		this.requestQueue = new RequestQueue<ClarityValue>(maxRequestsPerInterval, intervalMs, maxRetries, retryDelay);
	}

	/**
	 * Fetches data from a Stacks smart contract with caching and rate limiting
	 *
	 * @param contractAddress - The principal address of the contract
	 * @param contractName - The name of the contract
	 * @param functionName - The name of the function to call
	 * @param functionArgs - The arguments to pass to the function
	 * @param senderAddress - The address to use as the sender
	 * @param network - The Stacks network to use ('mainnet' or 'testnet')
	 * @param cacheKey - The key to use for caching the response
	 * @param bustCache - If true, bypass the cache and force a fresh request
	 * @returns A promise that resolves to the Clarity value returned by the function
	 */
	public async fetch(
		contractAddress: string,
		contractName: string,
		functionName: string,
		functionArgs: any[],
		senderAddress: string,
		network: string,
		cacheKey: string,
		bustCache = false
	): Promise<ClarityValue> {
		// Check cache first
		if (!bustCache) {
			const cached = await this.cacheService.get<ClarityValue>(cacheKey);
			if (cached) {
				return cached;
			}
		}

		// Validate network
		if (network !== 'mainnet' && network !== 'testnet') {
			throw new ApiError(ErrorCode.VALIDATION_ERROR, {
				message: `Invalid network: ${network}. Must be 'mainnet' or 'testnet'`,
			});
		}

		// Queue the request
		return this.requestQueue.enqueue(async () => {
			const response = await this.stacksApiService.callReadOnlyFunction(
				contractAddress,
				contractName,
				functionName,
				functionArgs,
				senderAddress,
				network
			);

			// Cache the result
			await this.cacheService.set(cacheKey, response);

			return response;
		});
	}
}

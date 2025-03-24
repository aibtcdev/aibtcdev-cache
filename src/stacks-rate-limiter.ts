import { ClarityValue } from '@stacks/transactions';
import { Env } from '../worker-configuration';
import { CacheService } from './services/cache-service';
import { StacksApiService } from './services/stacks-api-service';
import { RequestQueue } from './utils/request-queue';

export class StacksContractFetcher {
	private readonly cacheService: CacheService;
	private readonly stacksApiService: StacksApiService;
	private readonly requestQueue: RequestQueue<ClarityValue>;

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
			throw new Error(`Invalid network: ${network}. Must be 'mainnet' or 'testnet'`);
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

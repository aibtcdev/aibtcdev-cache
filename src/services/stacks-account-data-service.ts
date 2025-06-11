import { StacksNetworkName } from '@stacks/network';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { StacksApiService } from './stacks-api-service';
import { RequestQueue } from './request-queue-service';
import { getNetworkByPrincipal } from '../utils/stacks-network-util';

/**
 * Service for fetching data about Stacks accounts.
 * Handles rate limiting and retries for account-related API calls.
 */
export class StacksAccountDataService {
	private readonly stacksApiService: StacksApiService;
	private readonly requestQueue: RequestQueue<number>; // Queue for nonce (number) requests

	constructor(
		private readonly env: Env,
		maxRequestsPerInterval: number,
		intervalMs: number,
		maxRetries: number,
		retryDelay: number
	) {
		const config = AppConfig.getInstance(env).getConfig();
		const requestTimeout = config?.TIMEOUTS?.STACKS_API || 5000;

		this.stacksApiService = new StacksApiService(env);
		this.requestQueue = new RequestQueue<number>(maxRequestsPerInterval, intervalMs, maxRetries, retryDelay, env, requestTimeout);
	}

	/**
	 * Fetches the nonce for a Stacks account with rate limiting.
	 *
	 * @param address - The Stacks principal address.
	 * @returns A promise that resolves to the account's nonce.
	 */
	public async fetchNonce(address: string): Promise<number> {
		const network = getNetworkByPrincipal(address) as StacksNetworkName;

		// Queue the request to respect rate limits
		return this.requestQueue.enqueue(async () => {
			return this.stacksApiService.getAccountNonce(address, network);
		});
	}
}

import { Env } from '../worker-configuration';
import { ClarityValue, fetchCallReadOnlyFunction } from '@stacks/transactions';
import { ValidNetworks } from './utils/stacks';

interface QueuedContractCall {
	resolve: (value: ClarityValue) => void;
	reject: (reason?: any) => void;
	contractAddress: string;
	contractName: string;
	functionName: string;
	functionArgs: any[];
	senderAddress: string;
	network: ValidNetworks;
	cacheKey: string;
	retryCount: number;
}

function stringifyWithBigInt(value: unknown, replacer?: (key: string, value: unknown) => unknown, space?: string | number): string {
	const customReplacer = (key: string, val: unknown): unknown => {
		if (typeof val === 'bigint') {
			return val.toString() + 'n'; // Convert BigInt to string with 'n' suffix
		}
		if (replacer && typeof replacer === 'function') {
			return replacer(key, val);
		}
		return val;
	};

	return JSON.stringify(value, customReplacer, space);
}

export class StacksContractFetcher {
	private queue: QueuedContractCall[] = [];
	private processing = false;
	private lastRequestTime = 0;
	private tokens: number;
	private windowRequests: number = 0;
	private readonly minRequestSpacing: number;

	constructor(
		private readonly env: Env,
		private readonly cacheTtl: number,
		private readonly maxRequestsPerInterval: number,
		private readonly intervalMs: number,
		private readonly maxRetries: number,
		private readonly retryDelay: number
	) {
		this.tokens = maxRequestsPerInterval;
		this.minRequestSpacing = Math.max(250, Math.floor(intervalMs / maxRequestsPerInterval));
		this.startTokenReplenishment();
	}

	private startTokenReplenishment() {
		const replenishInterval = this.intervalMs / this.maxRequestsPerInterval;
		setInterval(() => {
			if (this.tokens < this.maxRequestsPerInterval) {
				this.tokens++;
				void this.processQueue();
			}
		}, replenishInterval);

		setInterval(() => {
			this.windowRequests = 0;
		}, this.intervalMs);
	}

	private async processQueue() {
		if (this.processing || this.queue.length === 0 || this.tokens <= 0) return;
		this.processing = true;

		try {
			while (this.queue.length > 0 && this.tokens > 0) {
				const now = Date.now();
				const timeSinceLastRequest = now - this.lastRequestTime;

				if (timeSinceLastRequest < this.minRequestSpacing) {
					await new Promise((resolve) => setTimeout(resolve, this.minRequestSpacing - timeSinceLastRequest));
				}

				const request = this.queue[0];
				const result = await this.processRequest(request);

				if (result.success) {
					this.queue.shift();
					this.tokens--;
					this.lastRequestTime = Date.now();
					this.windowRequests++;
				} else if (result.retry && request.retryCount < this.maxRetries) {
					this.queue.shift();
					request.retryCount++;
					this.queue.push(request);
					await new Promise((resolve) => setTimeout(resolve, this.retryDelay * request.retryCount));
				} else {
					this.queue.shift();
					request.reject(result.error);
				}
			}
		} finally {
			this.processing = false;
			if (this.queue.length > 0 && this.tokens > 0) {
				void this.processQueue();
			}
		}
	}

	private async processRequest(request: QueuedContractCall): Promise<{ success: boolean; retry?: boolean; error?: Error }> {
		try {
			const { contractAddress, contractName, functionName, functionArgs, senderAddress, network } = request;

			const response = await fetchCallReadOnlyFunction({
				contractAddress,
				contractName,
				functionName,
				functionArgs,
				senderAddress,
				network,
			});

			await this.env.AIBTCDEV_CACHE_KV.put(request.cacheKey, stringifyWithBigInt(response), { expirationTtl: this.cacheTtl });

			request.resolve(response);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				retry: true,
				error: error instanceof Error ? error : new Error('Unknown error occurred'),
			};
		}
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
	): Promise<any> {
		if (!this.env) {
			throw new Error('StacksContractFetcher not properly initialized');
		}
		const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);
		if (cached && !bustCache) {
			return JSON.parse(cached) as ClarityValue;
		}

		return new Promise((resolve, reject) => {
			if (network === 'mainnet' || network === 'testnet') {
				this.queue.push({
					resolve,
					reject,
					contractAddress,
					contractName,
					functionName,
					functionArgs,
					senderAddress,
					network,
					cacheKey,
					retryCount: 0,
				});
				void this.processQueue();
			}
		});
	}
}

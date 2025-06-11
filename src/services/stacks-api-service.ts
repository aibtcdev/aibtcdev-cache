import { StacksNetworkName } from '@stacks/network';
import { ClarityValue, fetchCallReadOnlyFunction } from '@stacks/transactions';
import { createApiKeyMiddleware, createFetchFn } from '@stacks/common';
import { AppConfig } from '../config';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { Logger } from '../utils/logger-util';
import { withTimeout } from '../utils/timeout-util';
import { Env } from '../../worker-configuration';

/**
 * Service for interacting with the Stacks blockchain API
 * Provides methods to call read-only functions on Stacks smart contracts
 */
export class StacksApiService {
	private readonly env: Env | undefined;
	private readonly timeoutMs: number;

	/**
	 * Creates a new Stacks API service
	 *
	 * @param env - Optional Cloudflare Worker environment
	 */
	constructor(env?: Env) {
		this.env = env;
		// Get timeout from config or use default
		const config = env ? AppConfig.getInstance(env).getConfig() : null;
		this.timeoutMs = config?.TIMEOUTS?.STACKS_API || 5000;
	}
	/**
	 * Calls a read-only function on a Stacks smart contract
	 *
	 * @param contractAddress - The principal address of the contract
	 * @param contractName - The name of the contract
	 * @param functionName - The name of the function to call
	 * @param functionArgs - The arguments to pass to the function
	 * @param senderAddress - The address to use as the sender
	 * @param network - The Stacks network to use (mainnet or testnet)
	 * @returns A promise that resolves to the Clarity value returned by the function
	 */
	async callReadOnlyFunction(
		contractAddress: string,
		contractName: string,
		functionName: string,
		functionArgs: any[],
		senderAddress: string,
		network: StacksNetworkName
	): Promise<ClarityValue> {
		const logger = Logger.getInstance(this.env);
		const startTime = Date.now();
		const requestId = logger.info(`Contract call started: ${contractAddress}.${contractName}::${functionName}`, {
			network,
			contractAddress,
			contractName,
			functionName,
			senderAddress,
		});

		try {
			// Create a custom fetch function with API key middleware if available
			let customFetchFn;
			if (this.env?.HIRO_API_KEY) {
				const apiMiddleware = createApiKeyMiddleware({
					apiKey: this.env.HIRO_API_KEY,
				});
				customFetchFn = createFetchFn(apiMiddleware);
			}

			// Wrap the fetch call with our timeout utility
			const result = await withTimeout(
				fetchCallReadOnlyFunction({
					contractAddress,
					contractName,
					functionName,
					functionArgs,
					senderAddress,
					network,
					fetchFn: customFetchFn, // Use the API key middleware if available
				}),
				this.timeoutMs,
				`Contract call to ${contractAddress}.${contractName}::${functionName} timed out`
			);

			const duration = Date.now() - startTime;
			if (duration > 2000) {
				// Log if call takes more than 2 seconds
				logger.warn(`Slow contract call: ${contractAddress}.${contractName}::${functionName}`, {
					requestId,
					duration,
					network,
					threshold: 2000,
				});
			} else {
				logger.debug(`Contract call completed: ${contractAddress}.${contractName}::${functionName}`, {
					requestId,
					duration,
					network,
				});
			}

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;

			// If it's already an ApiError (like our timeout error), just add context and rethrow
			if (error instanceof ApiError) {
				// Add more context to the error
				error.details = {
					...error.details,
					contract: `${contractAddress}.${contractName}`,
					function: functionName,
					network,
					duration,
					requestId,
				};

				logger.error(
					`Contract call failed: ${contractAddress}.${contractName}::${functionName} (${error.code})`,
					error instanceof Error ? error : new Error(String(error)),
					{
						requestId,
						duration,
						network,
						errorCode: error.code,
					}
				);

				throw error;
			}

			// Otherwise create a new API error
			logger.error(
				`Contract call failed: ${contractAddress}.${contractName}::${functionName}`,
				error instanceof Error ? error : new Error(String(error)),
				{
					requestId,
					duration,
					network,
					errorType: error instanceof Error ? error.constructor.name : typeof error,
				}
			);

			throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
				message: error instanceof Error ? error.message : String(error),
				contract: `${contractAddress}.${contractName}`,
				function: functionName,
				network,
				duration,
				requestId,
			});
		}
	}

	/**
	 * Fetches the current nonce for a given Stacks address using the Hiro API.
	 *
	 * @param address - The Stacks principal address.
	 * @param network - The Stacks network to use ('mainnet' or 'testnet').
	 * @returns A promise that resolves to the account's next possible nonce.
	 */
	async getAccountNonce(address: string, network: StacksNetworkName): Promise<number> {
		const logger = Logger.getInstance(this.env);
		const startTime = Date.now();
		const requestId = logger.info(`Fetching nonce for address: ${address} on ${network}`);

		const url = `https://api.${network}.hiro.so/extended/v1/addresses/${address}/nonces`;
		const headers: HeadersInit = {};

		if (this.env?.HIRO_API_KEY) {
			headers['x-hiro-api-key'] = this.env.HIRO_API_KEY;
		}

		try {
			const response = await withTimeout(
				fetch(url, { headers }),
				this.timeoutMs,
				`Nonce lookup for ${address} timed out`
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
					message: `Failed to fetch nonce: ${response.status} ${response.statusText}`,
					details: errorText,
					address,
				});
			}

			const data = (await response.json()) as { possible_next_nonce: number };
			const duration = Date.now() - startTime;
			logger.debug(`Nonce fetch completed for ${address}`, { requestId, duration });

			return data.possible_next_nonce;
		} catch (error) {
			const duration = Date.now() - startTime;
			logger.error(`Failed to fetch nonce for ${address}`, error instanceof Error ? error : new Error(String(error)), {
				requestId,
				duration,
			});

			// Re-throw as a consistent ApiError if it's not one already
			if (error instanceof ApiError) {
				throw error;
			}
			throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
				message: `Failed to fetch nonce: ${error instanceof Error ? error.message : String(error)}`,
				address,
			});
		}
	}
}

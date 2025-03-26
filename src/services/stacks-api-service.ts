import { StacksNetworkName } from '@stacks/network';
import { ClarityValue, fetchCallReadOnlyFunction } from '@stacks/transactions';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { Logger } from '../utils/logger-util';
import { withTimeout } from '../utils/timeout-util';
import { AppConfig } from '../config';
import { Env } from '../../worker-configuration';

/**
 * Service for interacting with the Stacks blockchain API
 * Provides methods to call read-only functions on Stacks smart contracts
 */
export class StacksApiService {
	private readonly env: Env;
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
		const requestId = logger.info(`Starting contract call to ${contractAddress}.${contractName}::${functionName}`, {
			network,
			contractAddress,
			functionName,
		});

		try {
			// Wrap the fetch call with our timeout utility
			const result = await withTimeout(
				fetchCallReadOnlyFunction({
					contractAddress,
					contractName,
					functionName,
					functionArgs,
					senderAddress,
					network,
				}),
				this.timeoutMs,
				`Contract call to ${contractAddress}.${contractName}::${functionName} timed out`
			);

			const duration = Date.now() - startTime;
			if (duration > 2000) {
				// Log if call takes more than 2 seconds
				logger.warn(`Slow contract call to ${contractAddress}.${contractName}::${functionName}`, {
					requestId,
					duration,
					network,
				});
			} else {
				logger.debug(`Completed contract call to ${contractAddress}.${contractName}::${functionName}`, {
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
					`Failed to call ${contractAddress}.${contractName}::${functionName}: ${error.code}`,
					error instanceof Error ? error : new Error(String(error)),
					{ requestId, duration, network }
				);
				
				throw error;
			}
			
			// Otherwise create a new API error
			logger.error(
				`Failed to call ${contractAddress}.${contractName}::${functionName}`,
				error instanceof Error ? error : new Error(String(error)),
				{ requestId, duration, network }
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
}

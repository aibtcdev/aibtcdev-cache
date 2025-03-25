import { StacksNetworkName } from '@stacks/network';
import { ClarityValue, fetchCallReadOnlyFunction } from '@stacks/transactions';
import { ApiError } from '../utils/api-error';
import { ErrorCode } from '../utils/error-catalog';
import { Logger } from '../utils/logger';

/**
 * Service for interacting with the Stacks blockchain API
 * Provides methods to call read-only functions on Stacks smart contracts
 */
export class StacksApiService {
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
		const logger = Logger.getInstance();
		const startTime = Date.now();

		try {
			const result = await fetchCallReadOnlyFunction({
				contractAddress,
				contractName,
				functionName,
				functionArgs,
				senderAddress,
				network,
			});

			const duration = Date.now() - startTime;
			if (duration > 2000) {
				// Log if call takes more than 2 seconds
				logger.warn(`Slow contract call to ${contractAddress}.${contractName}::${functionName}`, {
					duration,
					network,
				});
			}

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			logger.error(
				`Failed to call ${contractAddress}.${contractName}::${functionName}`,
				error instanceof Error ? error : new Error(String(error)),
				{ duration, network }
			);

			throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
				message: error instanceof Error ? error.message : String(error),
				contract: `${contractAddress}.${contractName}`,
				function: functionName,
				network,
			});
		}
	}
}

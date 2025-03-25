import { StacksNetworkName } from '@stacks/network';
import { ClarityValue, fetchCallReadOnlyFunction } from '@stacks/transactions';

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
		return fetchCallReadOnlyFunction({
			contractAddress,
			contractName,
			functionName,
			functionArgs,
			senderAddress,
			network,
		});
	}
}

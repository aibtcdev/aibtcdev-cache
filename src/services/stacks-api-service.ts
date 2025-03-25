import { StacksNetworkName } from '@stacks/network';
import { ClarityValue, fetchCallReadOnlyFunction } from '@stacks/transactions';

export class StacksApiService {
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

import { ClarityValue, fetchCallReadOnlyFunction } from '@stacks/transactions';
import { ValidNetworks } from '../utils/stacks';

export class StacksApiService {
  async callReadOnlyFunction(
    contractAddress: string,
    contractName: string,
    functionName: string,
    functionArgs: any[],
    senderAddress: string,
    network: ValidNetworks
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

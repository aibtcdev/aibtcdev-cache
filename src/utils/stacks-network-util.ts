import { StacksNetworkName } from '@stacks/network';
import { validateStacksAddress } from '@stacks/transactions';

// limited to just testnet/mainnet for now
export function getNetworkByPrincipal(principal: string): StacksNetworkName {
	// test if principal is valid
	if (validateStacksAddress(principal)) {
		// detect network from address
		const prefix = principal.substring(0, 2);
		if (prefix === 'SP' || prefix === 'SM') {
			return 'mainnet';
		} else if (prefix === 'ST' || prefix === 'SN') {
			return 'testnet';
		}
	}
	console.error('Invalid principal, falling back to testnet');
	return 'testnet';
}

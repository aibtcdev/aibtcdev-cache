import { StacksNetworkName } from '@stacks/network';
import { validateStacksAddress } from '@stacks/transactions';
import { Logger } from './logger';

/**
 * Determines the Stacks network (mainnet or testnet) based on a principal address
 *
 * Stacks addresses use different prefixes to indicate the network:
 * - SP/SM: Mainnet addresses
 * - ST/SN: Testnet addresses
 *
 * @param principal - The Stacks principal (address) to check
 * @returns The network name ('mainnet' or 'testnet')
 */
export function getNetworkByPrincipal(principal: string): StacksNetworkName {
	const logger = Logger.getInstance();

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

	logger.warn('Invalid principal, falling back to testnet', { principal });
	return 'testnet';
}

import { Env } from '../../worker-configuration';
import { ApiError } from './api-error';
import { ErrorCode } from './error-catalog';
import { Logger } from './logger';

/**
 * KV storage key for the list of known Stacks addresses
 */
const KNOWN_ADDRESSES_KEY = 'aibtcdev_known_stacks_addresses';

/**
 * Retrieves the list of known Stacks addresses from KV storage
 *
 * @param env - The Cloudflare Worker environment
 * @returns Array of known Stacks addresses
 */
export async function getKnownAddresses(env: Env): Promise<string[]> {
	const logger = Logger.getInstance(env);

	try {
		const addresses = await env.AIBTCDEV_CACHE_KV.get<string[]>(KNOWN_ADDRESSES_KEY, 'json');
		return addresses || [];
	} catch (error) {
		logger.error('Failed to get known addresses from KV', error instanceof Error ? error : new Error(String(error)));
		throw new ApiError(ErrorCode.CACHE_ERROR, {
			reason: 'Failed to retrieve known addresses',
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Adds a Stacks address to the list of known addresses in KV storage
 * Only adds the address if it's not already in the list
 *
 * @param env - The Cloudflare Worker environment
 * @param address - The Stacks address to add
 */
export async function addKnownAddress(env: Env, address: string): Promise<void> {
	const logger = Logger.getInstance(env);

	try {
		const addresses = await getKnownAddresses(env);
		if (!addresses.includes(address)) {
			addresses.push(address);
			await env.AIBTCDEV_CACHE_KV.put(KNOWN_ADDRESSES_KEY, JSON.stringify(addresses));
			logger.debug(`Added address ${address} to known addresses`, {
				totalAddresses: addresses.length,
			});
		}
	} catch (error) {
		// If it's already an ApiError (from getKnownAddresses), just log and rethrow
		if (error instanceof ApiError) {
			logger.error(`Failed to add known address ${address}`, undefined, {
				errorId: error.id,
				errorCode: error.code,
			});
			throw error;
		}

		// Otherwise wrap in an ApiError
		logger.error(`Failed to add known address ${address}`, error instanceof Error ? error : new Error(String(error)));
		throw new ApiError(ErrorCode.CACHE_ERROR, {
			reason: `Failed to add address ${address} to known addresses`,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

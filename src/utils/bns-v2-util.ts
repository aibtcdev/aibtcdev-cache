import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { getFetchOptions, setFetchOptions } from '@stacks/common';
import { BufferCV, ClarityType, principalCV, TupleCV } from '@stacks/transactions';
import { StacksContractFetcher } from '../services/stacks-contract-data-service';
import { ApiError } from './api-error';
import { ErrorCode } from './error-catalog';
import { Logger } from './logger';

/**
 * BNS contract constants for the Stacks blockchain
 */
const BNS_CONTRACT_ADDRESS = 'SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF';
const BNS_CONTRACT_NAME = 'BNS-V2';

/**
 * Type definition for BNS name response from the contract
 */
type NameResponse = {
	name: BufferCV;
	namespace: BufferCV;
};

/**
 * Workaround for using stacks.js fetch in Cloudflare Workers
 * Removes referrerPolicy which is not supported in Workers
 */
type StacksRequestInit = RequestInit & {
	referrerPolicy?: string;
};
const fetchOptions: StacksRequestInit = getFetchOptions();
delete fetchOptions.referrerPolicy;
setFetchOptions(fetchOptions);

/**
 * Converts a hex string to ASCII text
 *
 * @param hexString - Hex string or BigInt to convert
 * @returns ASCII string representation
 */
function hexToAscii(hexString: string | bigint): string {
	try {
		// Convert BigInt to hex string if needed
		const hex = typeof hexString === 'bigint' ? hexString.toString(16) : hexString.replace('0x', '');
		// Convert each pair of hex digits directly to ASCII
		let str = '';
		for (let i = 0; i < hex.length; i += 2) {
			str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
		}
		return str;
	} catch (error) {
		Logger.getInstance().error('Failed to convert hex to ASCII', error instanceof Error ? error : new Error(String(error)), {
			hexString: String(hexString),
		});
		// Return empty string on error rather than throwing
		// This is more graceful for display purposes
		return '';
	}
}

/**
 * Union type for BNS name responses from the contract
 */
type BnsNameResponse = BnsNameErrResponse | BnsNameSuccessResponse;

/**
 * Type for error responses from BNS contract
 */
type BnsNameErrResponse = {
	type: ClarityType.ResponseErr;
	value: string;
};

/**
 * Type for successful responses from BNS contract
 */
type BnsNameSuccessResponse = {
	type: ClarityType.ResponseOk;
	value: {
		type: ClarityType.OptionalSome;
		value: TupleCV<{
			name: BufferCV;
			namespace: BufferCV;
		}>;
	};
};

/**
 * Singleton instance of the StacksContractFetcher
 */
let stacksFetcher: StacksContractFetcher;

/**
 * Initializes the StacksContractFetcher with configuration from AppConfig
 *
 * @param env - The Cloudflare Worker environment
 */
export function initStacksFetcher(env: Env) {
	const logger = Logger.getInstance(env);
	const config = AppConfig.getInstance(env).getConfig();

	logger.debug('Initializing StacksContractFetcher for BNS lookups');

	stacksFetcher = new StacksContractFetcher(
		env,
		config.CACHE_TTL,
		config.MAX_REQUESTS_PER_INTERVAL,
		config.INTERVAL_MS,
		config.MAX_RETRIES,
		config.RETRY_DELAY
	);
}

/**
 * Retrieves the BNS name associated with a Stacks address
 *
 * @param address - The Stacks address to look up
 * @param network - The Stacks network to use (defaults to 'mainnet')
 * @returns The BNS name in format 'name.namespace' or empty string if not found
 * @throws Error if the StacksFetcher is not initialized or if the request fails
 */
export async function getNameFromAddress(address: string, network = 'mainnet'): Promise<string> {
	const logger = Logger.getInstance();

	if (!stacksFetcher) {
		throw new ApiError(ErrorCode.CONFIG_ERROR, {
			reason: 'StacksFetcher not initialized. Call initStacksFetcher first.',
		});
	}

	try {
		const startTime = Date.now();
		const addressCV = principalCV(address);
		const cacheKey = `bns_get-primary_${address}`;

		const response = (await stacksFetcher.fetch(
			BNS_CONTRACT_ADDRESS,
			BNS_CONTRACT_NAME,
			'get-primary',
			[addressCV],
			address,
			network,
			cacheKey
		)) as BnsNameResponse;

		const duration = Date.now() - startTime;
		if (duration > 1000) {
			logger.warn(`Slow BNS lookup for address ${address}`, { duration });
		}

		if (response.type === ClarityType.ResponseErr) {
			// name doesn't exist, return a blank string
			logger.debug(`No BNS name found for address ${address}`);
			return '';
		}

		if (
			response.type === ClarityType.ResponseOk &&
			response.value.type === ClarityType.OptionalSome &&
			response.value.value.type === ClarityType.Tuple
		) {
			const nameResponse = response.value.value as TupleCV<NameResponse>;
			const { name, namespace } = nameResponse.value;
			const nameStr = hexToAscii(name.value);
			const namespaceStr = hexToAscii(namespace.value);
			return `${nameStr}.${namespaceStr}`;
		}

		throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
			message: `Unexpected response type ${response.type}`,
			address,
		});
	} catch (error) {
		// If it's already an ApiError, rethrow it
		if (error instanceof ApiError) {
			throw error;
		}

		// Otherwise, wrap in an ApiError
		throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
			message: error instanceof Error ? error.message : String(error),
			address,
			network,
		});
	}
}

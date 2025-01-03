import { getFetchOptions, setFetchOptions } from '@stacks/common';
import { AppConfig } from '../config';
import { BufferCV, ClarityType, ClarityValue, principalCV, TupleCV } from '@stacks/transactions';
import { StacksContractFetcher } from '../stacks-rate-limiter';
import { Env } from '../../worker-configuration';
import { ValidNetworks } from './stacks';

const BNS_CONTRACT_ADDRESS = 'SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF';
const BNS_CONTRACT_NAME = 'BNS-V2';

type NameResponse = {
	name: BufferCV;
	namespace: BufferCV;
};

// workaround for using stacks.js fetch in Cloudflare Workers
type StacksRequestInit = RequestInit & {
	referrerPolicy?: string;
};
const fetchOptions: StacksRequestInit = getFetchOptions();
delete fetchOptions.referrerPolicy;
setFetchOptions(fetchOptions);

function hexToAscii(hexString: string | bigint): string {
	// Convert BigInt to hex string if needed
	const hex = typeof hexString === 'bigint' ? hexString.toString(16) : hexString.replace('0x', '');
	// Convert each pair of hex digits directly to ASCII
	let str = '';
	for (let i = 0; i < hex.length; i += 2) {
		str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
	}
	return str;
}

type BnsNameResponse = BnsNameErrResponse | BnsNameSuccessResponse;

type BnsNameErrResponse = {
	type: ClarityType.ResponseErr;
	value: string;
};

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

let stacksFetcher: StacksContractFetcher;

export function initStacksFetcher(env: Env) {
	const config = AppConfig.getInstance(env).getConfig();
	stacksFetcher = new StacksContractFetcher(
		env,
		config.CACHE_TTL,
		config.MAX_REQUESTS_PER_INTERVAL,
		config.INTERVAL_MS,
		config.MAX_RETRIES,
		config.RETRY_DELAY
	);
}

export async function getNameFromAddress(address: string, network: ValidNetworks = 'mainnet'): Promise<string> {
	if (!stacksFetcher) {
		throw new Error('StacksFetcher not initialized. Call initStacksFetcher first.');
	}
	try {
		const addressCV = principalCV(address);
		const cacheKey = `bns_get-primary_${address}`;
		const response: BnsNameResponse = await stacksFetcher.fetch(
			BNS_CONTRACT_ADDRESS,
			BNS_CONTRACT_NAME,
			'get-primary',
			[addressCV],
			address,
			network,
			cacheKey
		);
		if (response.type === ClarityType.ResponseErr) {
			// name doesn't exist, return a blank string
			// console.log(`getNameFromAddress: name not found for address ${address}`);
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
		throw new Error(`getNameFromAddress: unexpected response type ${response.type}`);
	} catch (error) {
		throw new Error(
			`Failed to get name for address ${address}, error: ${error ? (error instanceof Error ? error.message : String(error)) : 'unknown'}`
		);
	}
}

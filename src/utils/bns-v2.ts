import { getFetchOptions, setFetchOptions } from '@stacks/common';
import { BufferCV, ClarityType, fetchCallReadOnlyFunction, principalCV, TupleCV } from '@stacks/transactions';

const BNS_CONTRACT_ADDRESS = 'SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF';
const BNS_CONTRACT_NAME = 'BNS-V2';

type ValidNetworks = 'mainnet' | 'testnet';

type NameResponse = {
	name: BufferCV;
	namespace: BufferCV;
};

// workaround for using stacks.js fetch in Cloudflare Workers
type StacksRequestInit = RequestInit & {
	referrerPolicy?: string;
};
const fetchOptions: StacksRequestInit = getFetchOptions();
console.log(`fetchOptions: ${JSON.stringify(fetchOptions)}`);
delete fetchOptions.referrerPolicy;
setFetchOptions(fetchOptions);

function hexToAscii(bytes: Uint8Array) {
	let str = '';
	for (let n = 0; n < bytes.length; n += 1) {
		str += String.fromCharCode(bytes[n]);
	}
	return str;
}

export async function getNameFromAddress(address: string, network: ValidNetworks = 'mainnet'): Promise<string> {
	try {
		const addressCV = principalCV(address);
		const response = await fetchCallReadOnlyFunction({
			contractAddress: BNS_CONTRACT_ADDRESS,
			contractName: BNS_CONTRACT_NAME,
			functionName: 'get-primary',
			functionArgs: [addressCV],
			senderAddress: address,
			network: network,
		});
		if (response.type === ClarityType.ResponseErr) {
			throw new Error(`Failed to get name for address ${address}`);
		}
		if (response.type === ClarityType.ResponseOk) {
			const nameResponse = response.value as TupleCV<NameResponse>;
			const { name, namespace } = nameResponse.value;
			const nameStr = name.value;
			const namespaceStr = namespace.value;
			return `${nameStr}.${namespaceStr}`;
		}
		console.log(`response: ${JSON.stringify(response)}`);
		throw new Error('getNameFromAddress: unexpected response type');
	} catch (error) {
		console.log(`getNameFromAddress error: ${error}`);
		if (error instanceof Error) {
			throw error;
		}
		throw new Error(String(error));
	}
}

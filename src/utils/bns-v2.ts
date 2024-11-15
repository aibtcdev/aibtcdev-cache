import { BufferCV, ClarityType, fetchCallReadOnlyFunction, principalCV, TupleCV } from '@stacks/transactions';

const BNS_CONTRACT_ADDRESS = 'SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF';
const BNS_CONTRACT_NAME = 'BNS-V2';

type ValidNetworks = 'mainnet' | 'testnet';

type NameResponse = {
	name: BufferCV;
	namespace: BufferCV;
};

function hexToAscii(bytes: Uint8Array) {
	let str = '';
	for (let n = 0; n < bytes.length; n += 1) {
		str += String.fromCharCode(bytes[n]);
	}
	return str;
}

export async function getNameFromAddress(address: string, network: ValidNetworks = 'mainnet'): Promise<string> {
	const addressCV = principalCV(address);
	const response = await fetchCallReadOnlyFunction({
		contractAddress: BNS_CONTRACT_ADDRESS,
		contractName: BNS_CONTRACT_NAME,
		functionName: 'get-name',
		functionArgs: [addressCV],
		senderAddress: address,
		network: network,
	});
	if (response.type === ClarityType.ResponseErr) {
		throw new Error(`Failed to get name for address ${address}`);
	}
	if (response.type === ClarityType.ResponseOk) {
		const nameResponse = response.value as TupleCV<NameResponse>;
		const { name, namespace } = nameResponse.data;
		const nameStr = hexToAscii(name.buffer);
		const namespaceStr = hexToAscii(namespace.buffer);
		return `${nameStr}.${namespaceStr}`;
	}
	throw new Error('getNameFromAddress: unexpected response type');
}

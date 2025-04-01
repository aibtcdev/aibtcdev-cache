import { ClarityValue } from '@stacks/transactions';
import { createHash } from 'crypto';

/**
 * Service for generating consistent cache keys for contract calls
 * Ensures that identical calls produce the same cache key for better cache hit rates
 */
export class CacheKeyService {
	private readonly prefix: string;

	/**
	 * Creates a new cache key service
	 *
	 * @param prefix - Optional prefix for all generated cache keys
	 */
	constructor(prefix: string = 'cache') {
		this.prefix = prefix;
	}

	/**
	 * Generates a deterministic cache key for a contract call
	 *
	 * @param contractAddress - The contract address
	 * @param contractName - The contract name
	 * @param functionName - The function name
	 * @param functionArgs - The function arguments
	 * @param network - The network (mainnet/testnet)
	 * @returns A deterministic cache key string
	 */
	public generateContractCallKey(
		contractAddress: string,
		contractName: string,
		functionName: string,
		functionArgs: ClarityValue[],
		network: string
	): string {
		// Serialize function arguments to a stable string representation
		const argsString = this.serializeArgs(functionArgs);

		// Create a hash of the arguments to keep the key length reasonable
		const argsHash = this.createHash(argsString);

		// Combine all components into a single cache key
		return `${this.prefix}_${contractAddress}_${contractName}_${functionName}_${network}_${argsHash}`;
	}

	/**
	 * Creates a hash of the input string
	 *
	 * @param input - The string to hash
	 * @returns A short hash string
	 */
	private createHash(input: string): string {
		return createHash('sha256').update(input).digest('hex').substring(0, 10); // Use first 10 chars for brevity
	}

	/**
	 * Serializes function arguments to a stable string representation
	 *
	 * @param args - The function arguments to serialize
	 * @returns A string representation of the arguments
	 */
	private serializeArgs(args: ClarityValue[]): string {
		try {
			// Convert arguments to a stable JSON representation
			return JSON.stringify(args, (key, value) => {
				// Handle BigInt serialization
				if (typeof value === 'bigint') {
					return value.toString(); // Convert BigInt to string without 'n' suffix
				}
				// Handle Buffer serialization
				if (Buffer.isBuffer(value)) {
					return {
						type: 'Buffer',
						data: Array.from(value),
					};
				}
				return value;
			});
		} catch (error) {
			// If serialization fails, use a simpler approach
			return args.map((arg) => String(arg)).join('_');
		}
	}
}

import { Env } from '../../worker-configuration';
import { StacksNetworkName } from '@stacks/network';
import { ClarityAbi, ClarityAbiFunction, fetchAbi, validateStacksAddress } from '@stacks/transactions';
import { CacheService } from './kv-cache-service';
import { getNetworkByPrincipal } from '../utils/stacks-network-util';
import { ApiError } from '../utils/api-error';
import { ErrorCode } from '../utils/error-catalog';

/**
 * Service for fetching and managing Clarity smart contract ABIs
 * Handles caching, validation, and tracking of known contracts
 */
export class ContractAbiService {
	private readonly cacheService: CacheService;
	private readonly ABI_CACHE_KEY_PREFIX = 'contract_abi';
	private readonly KNOWN_CONTRACTS_KEY = 'known_contracts';

	/**
	 * Creates a new contract ABI service
	 *
	 * @param env - The Cloudflare Worker environment
	 * @param cacheTtl - Time-to-live in seconds for cached items (not used for ABIs)
	 */
	constructor(private readonly env: Env, private readonly cacheTtl: number) {
		// No TTL for ABIs since contract code never changes after deployment
		this.cacheService = new CacheService(env, 1000, true);
	}

	/**
	 * Fetches a contract's ABI and caches it indefinitely
	 *
	 * @param contractAddress - The principal address of the contract
	 * @param contractName - The name of the contract
	 * @param bustCache - If true, bypass the cache and force a fresh fetch
	 * @returns A promise that resolves to the contract's ABI
	 * @throws Error if the contract address is invalid or the ABI fetch fails
	 */
	async fetchContractABI(contractAddress: string, contractName: string, bustCache = false): Promise<ClarityAbi> {
		// Validate contract address
		if (!validateStacksAddress(contractAddress)) {
			throw new ApiError(ErrorCode.INVALID_CONTRACT_ADDRESS, { address: contractAddress });
		}

		const cacheKey = `${this.ABI_CACHE_KEY_PREFIX}_${contractAddress}_${contractName}`;

		// Check cache first
		if (!bustCache) {
			const cachedABI = await this.cacheService.get<ClarityAbi>(cacheKey);
			if (cachedABI) {
				return cachedABI;
			}
		}

		try {
			// Get the network from the contract address
			const network = getNetworkByPrincipal(contractAddress);
			// Fetch the ABI using the @stacks/transactions library
			const abi = await fetchAbi({
				contractAddress,
				contractName,
				network,
			});

			// Cache the ABI indefinitely (no TTL)
			await this.cacheService.set(cacheKey, abi);

			// Add to known contracts
			await this.addKnownContract(contractAddress, contractName);

			return abi;
		} catch (error) {
			throw new ApiError(ErrorCode.UPSTREAM_API_ERROR, {
				message: error instanceof Error ? error.message : String(error),
				contractAddress,
				contractName,
			});
		}
	}

	/**
	 * Validates if a function exists in the contract ABI
	 *
	 * @param abi - The contract ABI to check
	 * @param functionName - The name of the function to validate
	 * @returns True if the function exists in the ABI, false otherwise
	 */
	validateFunctionInABI(abi: ClarityAbi, functionName: string): boolean {
		if (!abi?.functions) {
			return false;
		}

		return abi.functions.some((func: ClarityAbiFunction) => func.name === functionName);
	}

	/**
	 * Validates function arguments against the ABI specification
	 *
	 * @param abi - The contract ABI to check against
	 * @param functionName - The name of the function to validate
	 * @param functionArgs - The arguments to validate
	 * @returns An object with valid flag and optional error message
	 */
	validateFunctionArgs(abi: ClarityAbi, functionName: string, functionArgs: any[]): { valid: boolean; error?: string } {
		if (!abi?.functions) {
			return { valid: false, error: 'Invalid ABI format' };
		}

		// Find the function in the ABI
		const functionSpec = abi.functions.find((func: ClarityAbiFunction) => func.name === functionName);
		if (!functionSpec) {
			return { valid: false, error: `Function ${functionName} not found in contract ABI` };
		}

		// Check if the function is read-only (public or read-only access)
		if (functionSpec.access !== 'public' && functionSpec.access !== 'read_only') {
			return { valid: false, error: `Function ${functionName} is not a read-only function` };
		}

		// Check argument count
		const expectedArgCount = functionSpec.args ? functionSpec.args.length : 0;
		if (functionArgs.length !== expectedArgCount) {
			return {
				valid: false,
				error: `Function ${functionName} expects ${expectedArgCount} arguments, but got ${functionArgs.length}`,
			};
		}

		return { valid: true };
	}

	/**
	 * Gets the list of known contracts that have been cached
	 *
	 * @returns A promise that resolves to an object with contract statistics and details
	 */
	async getKnownContracts(): Promise<{
		stats: { total: number; cached: number };
		contracts: { cached: Array<{ contractAddress: string; contractName: string }> };
	}> {
		const cachedContracts = await this.cacheService.get<Array<{ contractAddress: string; contractName: string }>>(this.KNOWN_CONTRACTS_KEY);

		const contracts = cachedContracts || [];

		return {
			stats: {
				total: contracts.length,
				cached: contracts.length,
			},
			contracts: {
				cached: contracts,
			},
		};
	}

	/**
	 * Adds a contract to the list of known contracts
	 *
	 * @param contractAddress - The principal address of the contract
	 * @param contractName - The name of the contract
	 */
	private async addKnownContract(contractAddress: string, contractName: string): Promise<void> {
		const knownContracts = await this.getKnownContracts();

		// Check if contract already exists
		const exists = knownContracts.contracts.cached.some(
			(contract) => contract.contractAddress === contractAddress && contract.contractName === contractName
		);

		if (!exists) {
			knownContracts.contracts.cached.push({
				contractAddress,
				contractName,
			});

			await this.cacheService.set(this.KNOWN_CONTRACTS_KEY, knownContracts.contracts.cached);
		}
	}
}

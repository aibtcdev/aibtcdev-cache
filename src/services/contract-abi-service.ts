import { ClarityAbi, ClarityAbiFunction, fetchAbi, validateStacksAddress } from '@stacks/transactions';
import { Env } from '../../worker-configuration';
import { CacheService } from './cache-service';
import { ValidNetworks } from '../utils/stacks';

/**
 * Service for fetching and managing contract ABIs
 */
export class ContractAbiService {
  private readonly cacheService: CacheService;
  private readonly ABI_CACHE_KEY_PREFIX = 'contract_abi';
  private readonly KNOWN_CONTRACTS_KEY = 'known_contracts';

  // Use a very long TTL for ABIs since contract code never changes after deployment
  private readonly ABI_CACHE_TTL = 31536000; // 1 year in seconds

  constructor(private readonly env: Env, private readonly cacheTtl: number) {
    this.cacheService = new CacheService(env, this.ABI_CACHE_TTL);
  }

  /**
   * Fetches a contract's ABI and caches it
   */
  async fetchContractABI(
    contractAddress: string,
    contractName: string,
    bustCache = false,
    network: ValidNetworks = 'mainnet'
  ): Promise<ClarityAbi> {
    // Validate contract address
    if (!validateStacksAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
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
      // Fetch the ABI using the @stacks/transactions library
      const abi = await fetchAbi({
        contractAddress,
        contractName,
        network,
      });

      // Cache the ABI indefinitely (using the 1-year TTL)
      await this.cacheService.set(cacheKey, abi, this.ABI_CACHE_TTL);

      // Add to known contracts
      await this.addKnownContract(contractAddress, contractName);

      return abi;
    } catch (error) {
      throw new Error(`Failed to fetch ABI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates if a function exists in the contract ABI
   */
  validateFunctionInABI(abi: ClarityAbi, functionName: string): boolean {
    if (!abi?.functions) {
      return false;
    }

    return abi.functions.some((func: ClarityAbiFunction) => func.name === functionName);
  }

  /**
   * Validates function arguments against the ABI specification
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
   * Gets the list of known contracts
   */
  async getKnownContracts(): Promise<{
    stats: { total: number; cached: number };
    contracts: { cached: Array<{ contractAddress: string; contractName: string }> };
  }> {
    const cachedContracts = await this.cacheService.get<Array<{ contractAddress: string; contractName: string }>>(
      this.KNOWN_CONTRACTS_KEY
    );

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

  /**
   * Fetches ABIs for contracts that don't have cached ABIs yet
   * Since contract code never changes after deployment, we don't need to refresh existing ABIs
   */
  async refreshAllContractABIs(): Promise<{
    success: number;
    failed: number;
    errors: string[];
    skipped: number;
  }> {
    const knownContracts = await this.getKnownContracts();
    
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
      skipped: 0
    };

    for (const contract of knownContracts.contracts.cached) {
      try {
        // Check if ABI is already cached
        const cacheKey = `${this.ABI_CACHE_KEY_PREFIX}_${contract.contractAddress}_${contract.contractName}`;
        const cachedABI = await this.cacheService.get<ClarityAbi>(cacheKey);
        
        if (cachedABI) {
          // Skip if already cached since contract code never changes
          results.skipped++;
          continue;
        }
        
        // Only fetch if not already cached
        await this.fetchContractABI(contract.contractAddress, contract.contractName, false);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Failed to update ABI for ${contract.contractAddress}.${contract.contractName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return results;
  }
}

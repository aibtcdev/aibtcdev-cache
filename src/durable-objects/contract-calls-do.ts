import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { createJsonResponse } from '../utils/requests-responses';
import { StacksContractFetcher } from '../stacks-rate-limiter';
import { CacheService } from '../services/cache-service';
import { validateStacksAddress } from '@stacks/transactions';
import { ValidNetworks } from '../utils/stacks';

/**
 * Interface for storing information about known contracts
 */
interface KnownContractsInfo {
  stats: {
    total: number;
    cached: number;
  };
  contracts: {
    cached: Array<{
      contractAddress: string;
      contractName: string;
    }>;
  };
}

/**
 * Durable Object class for handling contract calls
 */
export class ContractCallsDO extends DurableObject<Env> {
  // Configuration constants
  private readonly CACHE_TTL: number;
  private readonly MAX_REQUESTS_PER_MINUTE: number;
  private readonly INTERVAL_MS: number;
  private readonly MAX_RETRIES: number;
  private readonly RETRY_DELAY: number;
  private readonly ALARM_INTERVAL_MS = 600000; // 10 minutes
  
  // Base path and cache prefix
  private readonly BASE_PATH: string = '/contract-calls';
  private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
  
  // Supported endpoints
  private readonly SUPPORTED_ENDPOINTS: string[] = [
    '/read-only/{contractAddress}/{contractName}/{functionName}',
    '/abi/{contractAddress}/{contractName}',
    '/known-contracts'
  ];
  
  // Services
  private readonly cacheService: CacheService;
  private stacksContractFetcher: StacksContractFetcher;
  
  // Constants for ABI caching
  private readonly ABI_CACHE_KEY_PREFIX = 'contract_abi';
  private readonly KNOWN_CONTRACTS_KEY = 'known_contracts';

  /**
   * Constructor for the ContractCallsDO
   * 
   * @param ctx - The durable object state
   * @param env - The environment variables
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    // Initialize AppConfig with environment
    const config = AppConfig.getInstance(env).getConfig();

    // Set configuration values
    this.CACHE_TTL = config.CACHE_TTL;
    this.MAX_REQUESTS_PER_MINUTE = config.MAX_REQUESTS_PER_INTERVAL;
    this.INTERVAL_MS = config.INTERVAL_MS;
    this.MAX_RETRIES = config.MAX_RETRIES;
    this.RETRY_DELAY = config.RETRY_DELAY;

    // Initialize services
    this.cacheService = new CacheService(env, this.CACHE_TTL);
    this.stacksContractFetcher = new StacksContractFetcher(
      env,
      this.CACHE_TTL,
      this.MAX_REQUESTS_PER_MINUTE,
      this.INTERVAL_MS,
      this.MAX_RETRIES,
      this.RETRY_DELAY
    );

    // Set up alarm to run at configured interval
    ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
  }

  /**
   * Alarm handler that runs periodically to refresh cached data
   */
  async alarm(): Promise<void> {
    const startTime = Date.now();
    try {
      console.log('ContractCallsDO: refreshing cached contract ABIs');
      
      // Get known contracts from cache
      const knownContracts = await this.getKnownContracts();
      
      // Track success/failure for each contract
      const results = {
        success: 0,
        failed: 0,
        errors: [] as string[],
      };

      // Refresh ABIs for each known contract
      for (const contract of knownContracts.contracts.cached) {
        try {
          await this.fetchContractABI(
            contract.contractAddress, 
            contract.contractName, 
            true
          );
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push(
            `ContractCallsDO: failed to update ABI for ${contract.contractAddress}.${contract.contractName}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;
      const errors = results.errors.length > 0 ? results.errors.join(', ') : 'none';

      console.log(
        `ContractCallsDO: ${knownContracts.contracts.cached.length} contracts updated in ${totalDuration}ms, success: ${results.success}, failed: ${results.failed}, errors: ${errors}`
      );
    } catch (error) {
      console.error(`ContractCallsDO: alarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Always schedule next alarm if one isn't set
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null) {
        this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
      }
    }
  }

  /**
   * Main request handler for the Durable Object
   * 
   * @param request - The incoming request
   * @returns Response object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Always schedule next alarm if one isn't set
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
    }

    if (!path.startsWith(this.BASE_PATH)) {
      return createJsonResponse(
        {
          error: `Request at ${path} does not start with base path ${this.BASE_PATH}`,
        },
        404
      );
    }

    // Remove base path to get the endpoint
    const endpoint = path.replace(this.BASE_PATH, '');

    // Handle root path
    if (endpoint === '' || endpoint === '/') {
      return createJsonResponse({
        message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
      });
    }

    // Handle known contracts endpoint
    if (endpoint === '/known-contracts') {
      const knownContracts = await this.getKnownContracts();
      return createJsonResponse(knownContracts);
    }

    // Handle ABI endpoint
    if (endpoint.startsWith('/abi/')) {
      const parts = endpoint.split('/').filter(Boolean);
      if (parts.length !== 3) {
        return createJsonResponse(
          {
            error: 'Invalid ABI endpoint format. Use /abi/{contractAddress}/{contractName}',
          },
          400
        );
      }

      const contractAddress = parts[1];
      const contractName = parts[2];

      // Validate contract address
      if (!validateStacksAddress(contractAddress)) {
        return createJsonResponse(
          {
            error: `Invalid contract address: ${contractAddress}`,
          },
          400
        );
      }

      try {
        const abi = await this.fetchContractABI(contractAddress, contractName);
        return createJsonResponse(abi);
      } catch (error) {
        return createJsonResponse(
          {
            error: `Failed to fetch ABI: ${error instanceof Error ? error.message : String(error)}`,
          },
          500
        );
      }
    }

    // Handle read-only contract call endpoint
    if (endpoint.startsWith('/read-only/')) {
      const parts = endpoint.split('/').filter(Boolean);
      if (parts.length !== 4) {
        return createJsonResponse(
          {
            error: 'Invalid read-only endpoint format. Use /read-only/{contractAddress}/{contractName}/{functionName}',
          },
          400
        );
      }

      const contractAddress = parts[1];
      const contractName = parts[2];
      const functionName = parts[3];

      // Validate contract address
      if (!validateStacksAddress(contractAddress)) {
        return createJsonResponse(
          {
            error: `Invalid contract address: ${contractAddress}`,
          },
          400
        );
      }

      // Only accept POST requests for contract calls
      if (request.method !== 'POST') {
        return createJsonResponse(
          {
            error: 'Only POST requests are supported for contract calls',
          },
          405
        );
      }

      try {
        // Parse function arguments from request body
        const body = await request.json();
        const functionArgs = body.functionArgs || [];
        const network = (body.network || 'mainnet') as ValidNetworks;
        const senderAddress = body.senderAddress || contractAddress;

        // Get ABI to validate function arguments
        const abi = await this.fetchContractABI(contractAddress, contractName);
        
        // Validate function exists in ABI
        if (!this.validateFunctionInABI(abi, functionName)) {
          return createJsonResponse(
            {
              error: `Function ${functionName} not found in contract ABI`,
            },
            400
          );
        }

        // Execute contract call
        const result = await this.executeReadOnlyCall(
          contractAddress,
          contractName,
          functionName,
          functionArgs,
          senderAddress,
          network
        );

        return createJsonResponse(result);
      } catch (error) {
        return createJsonResponse(
          {
            error: `Contract call failed: ${error instanceof Error ? error.message : String(error)}`,
          },
          500
        );
      }
    }

    // If we get here, the endpoint is not supported
    return createJsonResponse(
      {
        error: `Unsupported endpoint: ${endpoint}`,
        supportedEndpoints: this.SUPPORTED_ENDPOINTS,
      },
      404
    );
  }

  /**
   * Fetches a contract's ABI and caches it
   * 
   * @param contractAddress - The contract's address
   * @param contractName - The contract's name
   * @param bustCache - Whether to bypass the cache
   * @returns The contract ABI
   */
  private async fetchContractABI(
    contractAddress: string,
    contractName: string,
    bustCache = false
  ): Promise<any> {
    const cacheKey = `${this.ABI_CACHE_KEY_PREFIX}_${contractAddress}_${contractName}`;
    
    // Check cache first
    if (!bustCache) {
      const cachedABI = await this.cacheService.get(cacheKey);
      if (cachedABI) {
        return cachedABI;
      }
    }

    // Fetch ABI from Stacks API
    // This would typically use a service to fetch the ABI
    // For now, we'll use a placeholder implementation
    try {
      // TODO: Implement actual ABI fetching logic
      // This would typically call a Stacks API endpoint to get the contract ABI
      
      // For now, we'll use a mock implementation
      const abi = await this.fetchContractABIFromAPI(contractAddress, contractName);
      
      // Cache the ABI
      await this.cacheService.set(cacheKey, abi);
      
      // Add to known contracts
      await this.addKnownContract(contractAddress, contractName);
      
      return abi;
    } catch (error) {
      throw new Error(`Failed to fetch ABI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Placeholder method to fetch contract ABI from an API
   * This would be replaced with actual implementation
   * 
   * @param contractAddress - The contract's address
   * @param contractName - The contract's name
   * @returns The contract ABI
   */
  private async fetchContractABIFromAPI(
    contractAddress: string,
    contractName: string
  ): Promise<any> {
    // This is a placeholder. In a real implementation, this would call the Stacks API
    // to fetch the contract ABI.
    
    // For now, we'll return a mock ABI
    return {
      functions: [
        {
          name: "get-balance",
          access: "public",
          args: [{ name: "owner", type: "principal" }],
          outputs: { type: "uint128" }
        },
        {
          name: "transfer",
          access: "public",
          args: [
            { name: "amount", type: "uint128" },
            { name: "sender", type: "principal" },
            { name: "recipient", type: "principal" }
          ],
          outputs: { type: "bool" }
        }
      ],
      variables: [
        {
          name: "token-name",
          type: "string-ascii",
          access: "constant"
        },
        {
          name: "token-symbol",
          type: "string-ascii",
          access: "constant"
        }
      ],
      maps: [
        {
          name: "balances",
          key: "principal",
          value: "uint128"
        }
      ],
      non_fungible_tokens: []
    };
  }

  /**
   * Validates if a function exists in the contract ABI
   * 
   * @param abi - The contract ABI
   * @param functionName - The function name to validate
   * @returns True if the function exists in the ABI
   */
  private validateFunctionInABI(abi: any, functionName: string): boolean {
    if (!abi || !abi.functions) {
      return false;
    }
    
    return abi.functions.some((func: any) => func.name === functionName);
  }

  /**
   * Executes a read-only contract call
   * 
   * @param contractAddress - The contract's address
   * @param contractName - The contract's name
   * @param functionName - The function to call
   * @param functionArgs - The function arguments
   * @param senderAddress - The sender's address
   * @param network - The network to use (mainnet or testnet)
   * @returns The result of the contract call
   */
  private async executeReadOnlyCall(
    contractAddress: string,
    contractName: string,
    functionName: string,
    functionArgs: any[],
    senderAddress: string,
    network: ValidNetworks
  ): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}_call_${contractAddress}_${contractName}_${functionName}_${JSON.stringify(functionArgs)}_${senderAddress}_${network}`;
    
    try {
      const result = await this.stacksContractFetcher.fetch(
        contractAddress,
        contractName,
        functionName,
        functionArgs,
        senderAddress,
        network,
        cacheKey
      );
      
      return result;
    } catch (error) {
      throw new Error(`Contract call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Gets the list of known contracts
   * 
   * @returns Information about known contracts
   */
  private async getKnownContracts(): Promise<KnownContractsInfo> {
    const cachedContracts = await this.cacheService.get<Array<{contractAddress: string, contractName: string}>>(this.KNOWN_CONTRACTS_KEY);
    
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
   * @param contractAddress - The contract's address
   * @param contractName - The contract's name
   */
  private async addKnownContract(contractAddress: string, contractName: string): Promise<void> {
    const knownContracts = await this.getKnownContracts();
    
    // Check if contract already exists
    const exists = knownContracts.contracts.cached.some(
      contract => 
        contract.contractAddress === contractAddress && 
        contract.contractName === contractName
    );
    
    if (!exists) {
      knownContracts.contracts.cached.push({
        contractAddress,
        contractName,
      });
      
      await this.cacheService.set(
        this.KNOWN_CONTRACTS_KEY, 
        knownContracts.contracts.cached
      );
    }
  }
}

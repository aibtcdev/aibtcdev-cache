import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { createJsonResponse } from '../utils/requests-responses';
import { StacksContractFetcher } from '../stacks-rate-limiter';
import { ClarityValue, validateStacksAddress } from '@stacks/transactions';
import { ValidNetworks } from '../utils/stacks';
import { ContractAbiService } from '../services/contract-abi-service';

/**
 * Interface for expected request body for contract calls
 */
interface ContractCallRequest {
  functionArgs: ClarityValue[];
  network: ValidNetworks;
  senderAddress: string;
}

/**
 * Durable Object class for handling contract calls
 */
export class ContractCallsDO extends DurableObject<Env> {
  // Configuration constants
  private readonly CACHE_TTL: number;
  private readonly ALARM_INTERVAL_MS = 3600000; // 1 hour - only checking for new contracts

  // Base path and cache prefix
  private readonly BASE_PATH: string = '/contract-calls';
  private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');

  // Supported endpoints
  private readonly SUPPORTED_ENDPOINTS: string[] = [
    '/read-only/{contractAddress}/{contractName}/{functionName}',
    '/abi/{contractAddress}/{contractName}',
    '/known-contracts',
  ];

  // Services
  private readonly contractAbiService: ContractAbiService;
  private readonly stacksContractFetcher: StacksContractFetcher;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    // Initialize AppConfig with environment
    const config = AppConfig.getInstance(env).getConfig();

    // Set configuration values
    this.CACHE_TTL = config.CACHE_TTL;

    // Initialize services
    this.contractAbiService = new ContractAbiService(env, this.CACHE_TTL);
    this.stacksContractFetcher = new StacksContractFetcher(
      env,
      this.CACHE_TTL,
      config.MAX_REQUESTS_PER_INTERVAL,
      config.INTERVAL_MS,
      config.MAX_RETRIES,
      config.RETRY_DELAY
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
      console.log('ContractCallsDO: checking for new contracts to cache ABIs');

      const results = await this.contractAbiService.refreshAllContractABIs();
      
      const endTime = Date.now();
      const totalDuration = endTime - startTime;
      const errors = results.errors.length > 0 ? results.errors.join(', ') : 'none';

      console.log(
        `ContractCallsDO: contract check completed in ${totalDuration}ms, success: ${results.success}, skipped: ${results.skipped}, failed: ${results.failed}, errors: ${errors}`
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
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Always schedule next alarm if one isn't set
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      this.ctx.storage.setAlarm(Date.now() + this.ALARM_INTERVAL_MS);
    }

    try {
      if (!path.startsWith(this.BASE_PATH)) {
        return createJsonResponse({ error: `Invalid path: ${path}` }, 404);
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
        const knownContracts = await this.contractAbiService.getKnownContracts();
        return createJsonResponse(knownContracts);
      }

      // Handle ABI endpoint
      if (endpoint.startsWith('/abi/')) {
        return await this.handleAbiRequest(endpoint);
      }

      // Handle read-only contract call endpoint
      if (endpoint.startsWith('/read-only/')) {
        return await this.handleReadOnlyRequest(endpoint, request);
      }

      // If we get here, the endpoint is not supported
      return createJsonResponse(
        {
          error: `Unsupported endpoint: ${endpoint}`,
          supportedEndpoints: this.SUPPORTED_ENDPOINTS,
        },
        404
      );
    } catch (error) {
      return createJsonResponse(
        { error: `Request failed: ${error instanceof Error ? error.message : String(error)}` },
        500
      );
    }
  }

  /**
   * Handles ABI requests
   */
  private async handleAbiRequest(endpoint: string): Promise<Response> {
    const parts = endpoint.split('/').filter(Boolean);
    if (parts.length !== 3) {
      return createJsonResponse(
        { error: 'Invalid ABI endpoint format. Use /abi/{contractAddress}/{contractName}' },
        400
      );
    }

    const contractAddress = parts[1];
    const contractName = parts[2];

    try {
      const abi = await this.contractAbiService.fetchContractABI(contractAddress, contractName);
      return createJsonResponse(abi);
    } catch (error) {
      return createJsonResponse(
        { error: `Failed to fetch ABI: ${error instanceof Error ? error.message : String(error)}` },
        error instanceof Error && error.message.includes('Invalid contract address') ? 400 : 500
      );
    }
  }

  /**
   * Handles read-only contract call requests
   */
  private async handleReadOnlyRequest(endpoint: string, request: Request): Promise<Response> {
    const parts = endpoint.split('/').filter(Boolean);
    if (parts.length !== 4) {
      return createJsonResponse(
        { error: 'Invalid read-only endpoint format. Use /read-only/{contractAddress}/{contractName}/{functionName}' },
        400
      );
    }

    const contractAddress = parts[1];
    const contractName = parts[2];
    const functionName = parts[3];

    // Validate contract address
    if (!validateStacksAddress(contractAddress)) {
      return createJsonResponse({ error: `Invalid contract address: ${contractAddress}` }, 400);
    }

    // Only accept POST requests for contract calls
    if (request.method !== 'POST') {
      return createJsonResponse({ error: 'Only POST requests are supported for contract calls' }, 405);
    }

    try {
      // Parse function arguments from request body
      const body = (await request.json()) as ContractCallRequest;
      const functionArgs = body.functionArgs || [];
      const network = (body.network || 'mainnet') as ValidNetworks;
      const senderAddress = body.senderAddress || contractAddress;

      // Get ABI to validate function arguments
      const abi = await this.contractAbiService.fetchContractABI(contractAddress, contractName, false, network);

      // Validate function exists in ABI
      if (!this.contractAbiService.validateFunctionInABI(abi, functionName)) {
        return createJsonResponse({ error: `Function ${functionName} not found in contract ABI` }, 400);
      }

      // Validate function arguments
      const argsValidation = this.contractAbiService.validateFunctionArgs(abi, functionName, functionArgs);
      if (!argsValidation.valid) {
        return createJsonResponse({ error: argsValidation.error || 'Invalid function arguments' }, 400);
      }

      // Execute contract call
      const cacheKey = `${this.CACHE_PREFIX}_call_${contractAddress}_${contractName}_${functionName}_${JSON.stringify(
        functionArgs
      )}_${senderAddress}_${network}`;

      const result = await this.stacksContractFetcher.fetch(
        contractAddress,
        contractName,
        functionName,
        functionArgs,
        senderAddress,
        network,
        cacheKey
      );

      return createJsonResponse(result);
    } catch (error) {
      return createJsonResponse(
        { error: `Contract call failed: ${error instanceof Error ? error.message : String(error)}` },
        500
      );
    }
  }
}

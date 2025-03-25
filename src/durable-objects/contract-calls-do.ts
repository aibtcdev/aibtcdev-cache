import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { StacksNetworkName } from '@stacks/network';
import { ClarityValue, validateStacksAddress } from '@stacks/transactions';
import { ContractAbiService } from '../services/stacks-contract-abi-service';
import { StacksContractFetcher } from '../services/stacks-contract-data-service';
import { createJsonResponse } from '../utils/requests-responses-util';

/**
 * Interface for expected request body for contract calls
 */
interface ContractCallRequest {
	functionArgs: ClarityValue[];
	network: StacksNetworkName;
	senderAddress: string;
}

/**
 * Durable Object class for handling contract calls
 */
export class ContractCallsDO extends DurableObject<Env> {
	// Configuration constants
	private readonly CACHE_TTL: number;
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

		// No alarm configured yet
	}

	/**
	 * Main request handler for the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

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
			return createJsonResponse({ error: `Request failed: ${error instanceof Error ? error.message : String(error)}` }, 500);
		}
	}

	/**
	 * Handles ABI requests
	 */
	private async handleAbiRequest(endpoint: string): Promise<Response> {
		const parts = endpoint.split('/').filter(Boolean);
		if (parts.length !== 3) {
			return createJsonResponse({ error: 'Invalid ABI endpoint format. Use /abi/{contractAddress}/{contractName}' }, 400);
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
			const network = (body.network || 'testnet') as StacksNetworkName;
			const senderAddress = body.senderAddress || contractAddress;

			// Get ABI to validate function arguments
			const abi = await this.contractAbiService.fetchContractABI(contractAddress, contractName, false);

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
			const cacheKey = `${this.CACHE_PREFIX}_call_${contractAddress}_${contractName}_${functionName}_${new Date().getTime()}`;

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
			return createJsonResponse({ error: `Contract call failed: ${error instanceof Error ? error.message : String(error)}` }, 500);
		}
	}
}

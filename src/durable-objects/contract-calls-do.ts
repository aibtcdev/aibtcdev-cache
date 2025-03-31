import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { StacksNetworkName } from '@stacks/network';
import { ClarityValue, deserializeCV, validateStacksAddress } from '@stacks/transactions';
import { CacheKeyService } from '../services/cache-key-service';
import { ContractAbiService } from '../services/stacks-contract-abi-service';
import { StacksContractFetcher } from '../services/stacks-contract-data-service';
import { decodeClarityValues, SimplifiedClarityValue, convertToClarityValue } from '../utils/clarity-responses-util';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { handleRequest } from '../utils/request-handler-util';

/**
 * Interface for expected request body for contract calls
 *
 * This defines the structure of the JSON payload that must be sent
 * when making read-only contract function calls.
 *
 * The functionArgs can be either:
 * - ClarityValue[] - For TypeScript clients using @stacks/transactions
 * - SimplifiedClarityValue[] - For non-TypeScript clients using a simpler JSON format
 */
interface ContractCallRequest {
	functionArgs: (ClarityValue | SimplifiedClarityValue)[];
	network?: StacksNetworkName;
	senderAddress?: string;
	strictJsonCompat?: boolean;
	preserveContainers?: boolean;
	// Cache control options
	cacheControl?: {
		bustCache?: boolean; // If true, bypass cache and force a fresh request
		ttl?: number; // Custom TTL in seconds, if not provided uses default or infinite
		skipCache?: boolean; // If true, don't cache the result of this request
	};
}

/**
 * Durable Object class for handling Stacks smart contract calls
 *
 * This Durable Object provides endpoints for:
 * 1. Making read-only function calls to Stacks smart contracts
 * 2. Retrieving contract ABIs (Application Binary Interfaces)
 * 3. Listing known contracts that have been previously accessed
 *
 * It handles validation of contract addresses, function names, and arguments
 * before executing calls to the blockchain.
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
		'/decode-clarity-value',
	];
	// Services
	private readonly contractAbiService: ContractAbiService;
	private readonly stacksContractFetcher: StacksContractFetcher;
	private readonly cacheKeyService: CacheKeyService;

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

		// Use Hiro API specific rate limiting settings since this DO makes calls to Stacks API
		const hiroConfig = config.HIRO_API_RATE_LIMIT;
		this.stacksContractFetcher = new StacksContractFetcher(
			env,
			this.CACHE_TTL,
			hiroConfig.MAX_REQUESTS_PER_INTERVAL,
			hiroConfig.INTERVAL_MS,
			config.MAX_RETRIES,
			config.RETRY_DELAY
		);

		// Initialize cache key service with a prefix for this DO
		this.cacheKeyService = new CacheKeyService(this.CACHE_PREFIX);

		// No alarm configured yet
	}

	/**
	 * Main request handler for the Durable Object
	 */
	/**
	 * Main request handler for the Contract Calls Durable Object
	 *
	 * Handles the following endpoints:
	 * - / - Returns a list of supported endpoints
	 * - /abi/{contractAddress}/{contractName} - Returns the ABI for a contract
	 * - /read-only/{contractAddress}/{contractName}/{functionName} - Makes a read-only call to a contract function
	 * - /known-contracts - Lists all contracts that have been accessed
	 *
	 * @param request - The incoming HTTP request
	 * @returns A Response object with the requested data or an error message
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		return handleRequest(
			async () => {
				if (!path.startsWith(this.BASE_PATH)) {
					throw new ApiError(ErrorCode.NOT_FOUND, { resource: path });
				}

				// Remove base path to get the endpoint
				const endpoint = path.replace(this.BASE_PATH, '');

				// Handle root path
				if (endpoint === '' || endpoint === '/') {
					return {
						message: `Supported endpoints: ${this.SUPPORTED_ENDPOINTS.join(', ')}`,
					};
				}

				// Handle known contracts endpoint
				if (endpoint === '/known-contracts') {
					return await this.contractAbiService.getKnownContracts();
				}

				// Handle ABI endpoint
				if (endpoint.startsWith('/abi/')) {
					return await this.handleAbiRequest(endpoint);
				}

				// Handle read-only contract call endpoint
				if (endpoint.startsWith('/read-only/')) {
					return await this.handleReadOnlyRequest(endpoint, request);
				}

				// Handle decode clarity value endpoint
				if (endpoint === '/decode-clarity-value') {
					return await this.handleDecodeClarityValueRequest(request);
				}

				// If we get here, the endpoint is not supported
				throw new ApiError(ErrorCode.NOT_FOUND, {
					resource: endpoint,
					supportedEndpoints: this.SUPPORTED_ENDPOINTS,
				});
			},
			this.env,
			{
				// Contract calls can be slow, so set a higher threshold
				slowThreshold: 2000, // 2 seconds
				path,
				method,
			}
		);
	}

	/**
	 * Handles requests for contract ABIs
	 *
	 * Parses the endpoint path to extract the contract address and name,
	 * then fetches the ABI from the blockchain or cache.
	 *
	 * @param endpoint - The endpoint path after the base path, e.g., "/abi/SP2X0TH53NBMJ7HD7KA5XT5N9MPDH0VK14KGAT1TF/my-contract"
	 * @returns A Response object with the ABI or an error message
	 */
	private async handleAbiRequest(endpoint: string): Promise<any> {
		const parts = endpoint.split('/').filter(Boolean);
		if (parts.length !== 3) {
			throw new ApiError(ErrorCode.INVALID_REQUEST, {
				reason: 'Invalid ABI endpoint format. Use /abi/{contractAddress}/{contractName}',
			});
		}

		const contractAddress = parts[1];
		const contractName = parts[2];

		try {
			return await this.contractAbiService.fetchContractABI(contractAddress, contractName);
		} catch (error) {
			// Convert specific errors to ApiErrors
			if (error instanceof Error && error.message.includes('Invalid contract address')) {
				throw new ApiError(ErrorCode.INVALID_CONTRACT_ADDRESS, { address: contractAddress });
			}
			// Re-throw other errors
			throw error;
		}
	}

	/**
	 * Handles read-only contract function call requests
	 *
	 * This method:
	 * 1. Parses the endpoint to extract contract address, name, and function
	 * 2. Validates the contract address
	 * 3. Extracts function arguments from the request body
	 * 4. Validates the function exists in the contract ABI
	 * 5. Validates the function arguments match the expected types
	 * 6. Executes the contract call and returns the result
	 *
	 * @param endpoint - The endpoint path after the base path
	 * @param request - The original HTTP request containing function arguments
	 * @returns A Response with the function call result or an error message
	 */
	private async handleReadOnlyRequest(endpoint: string, request: Request): Promise<any> {
		const parts = endpoint.split('/').filter(Boolean);
		if (parts.length !== 4) {
			throw new ApiError(ErrorCode.INVALID_REQUEST, {
				reason: 'Invalid read-only endpoint format. Use /read-only/{contractAddress}/{contractName}/{functionName}',
			});
		}

		const contractAddress = parts[1];
		const contractName = parts[2];
		const functionName = parts[3];

		// Validate contract address
		if (!validateStacksAddress(contractAddress)) {
			throw new ApiError(ErrorCode.INVALID_CONTRACT_ADDRESS, { address: contractAddress });
		}

		// Only accept POST requests for contract calls
		if (request.method !== 'POST') {
			throw new ApiError(ErrorCode.INVALID_REQUEST, {
				reason: 'Only POST requests are supported for contract calls',
			});
		}

		// Parse function arguments from request body
		const body = (await request.json()) as ContractCallRequest;
		const rawFunctionArgs = body.functionArgs || [];
		const network = (body.network || 'testnet') as StacksNetworkName;
		const senderAddress = body.senderAddress || contractAddress;
		// Default to true unless explicitly set to false for consistent BigInt handling
		const strictJsonCompat = body.strictJsonCompat !== false;
		const preserveContainers = body.preserveContainers || false;

		// Convert any simplified arguments to ClarityValues
		const functionArgs = rawFunctionArgs.map(convertToClarityValue);

		// Get ABI to validate function arguments
		const abi = await this.contractAbiService.fetchContractABI(contractAddress, contractName, false);

		// Validate function exists in ABI
		if (!this.contractAbiService.validateFunctionInABI(abi, functionName)) {
			throw new ApiError(ErrorCode.INVALID_FUNCTION, {
				function: functionName,
				contract: `${contractAddress}.${contractName}`,
			});
		}

		// Validate function arguments
		const argsValidation = this.contractAbiService.validateFunctionArgs(abi, functionName, functionArgs);
		if (!argsValidation.valid) {
			throw new ApiError(ErrorCode.INVALID_ARGUMENTS, {
				function: functionName,
				reason: argsValidation.error || 'Invalid function arguments',
			});
		}

		// Get cache control options from request
		const cacheControl = body.cacheControl || {};
		const bustCache = cacheControl.bustCache || false;
		const skipCache = cacheControl.skipCache || false;

		// Generate a deterministic cache key based on the contract call parameters
		const cacheKey = this.cacheKeyService.generateContractCallKey(contractAddress, contractName, functionName, functionArgs, network);

		// Determine TTL - use custom TTL if provided, otherwise cache indefinitely (0)
		const ttl = cacheControl.ttl !== undefined ? cacheControl.ttl : 0;

		// Execute contract call with our caching strategy
		const result = await this.stacksContractFetcher.fetch(
			contractAddress,
			contractName,
			functionName,
			functionArgs,
			senderAddress,
			network,
			cacheKey,
			bustCache,
			skipCache,
			ttl
		);

		return decodeClarityValues(result, strictJsonCompat, preserveContainers);
	}

	/**
	 * Handles requests to decode Clarity values
	 *
	 * This endpoint accepts a POST request with a ClarityValue and optional parameters,
	 * and returns the decoded JavaScript representation of the value.
	 *
	 * @param request - The HTTP request containing the ClarityValue to decode
	 * @returns A Response with the decoded value or an error message
	 */
	private async handleDecodeClarityValueRequest(request: Request): Promise<any> {
		// Only accept POST requests for decoding
		if (request.method !== 'POST') {
			throw new ApiError(ErrorCode.INVALID_REQUEST, {
				reason: 'Only POST requests are supported for decoding Clarity values',
			});
		}

		// Parse request body
		const body = (await request.json()) as {
			clarityValue: ClarityValue | SimplifiedClarityValue | string;
			strictJsonCompat?: boolean;
			preserveContainers?: boolean;
		};

		if (!body.clarityValue) {
			throw new ApiError(ErrorCode.INVALID_REQUEST, {
				reason: 'Missing required field: clarityValue',
			});
		}

		// Convert ClarityValue to ClarityValue if necessary
		let clarityValue: ClarityValue;
		try {
			if (typeof body.clarityValue === 'string') {
				clarityValue = deserializeCV(body.clarityValue);
			} else {
				clarityValue = convertToClarityValue(body.clarityValue);
			}
		} catch (error) {
			throw new ApiError(ErrorCode.VALIDATION_ERROR, {
				message: `Invalid Clarity value format: ${error instanceof Error ? error.message : String(error)}`,
			});
		}

		// Decode the value with the provided options
		const decodedValue = decodeClarityValues(
			clarityValue,
			body.strictJsonCompat !== false, // Default to true unless explicitly set to false
			body.preserveContainers === true // Default to false unless explicitly set to true
		);

		return {
			original: body.clarityValue,
			decoded: decodedValue,
		};
	}
}

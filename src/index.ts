import { Env } from '../worker-configuration';
import { AppConfig } from './config';
import { BnsApiDO } from './durable-objects/bns-do';
import { HiroApiDO } from './durable-objects/hiro-api-do';
import { StxCityDO } from './durable-objects/stx-city-do';
import { SupabaseDO } from './durable-objects/supabase-do';
import { ContractCallsDO, ContractCallRequest } from './durable-objects/contract-calls-do';
import { corsHeaders, createErrorResponse, createSuccessResponse } from './utils/requests-responses-util';
import { ApiError } from './utils/api-error-util';
import { ErrorCode } from './utils/error-catalog-util';
import { Logger } from './utils/logger-util';
import { CacheService } from './services/kv-cache-service';
import { CacheKeyService } from './services/cache-key-service';
import { ClarityValue } from '@stacks/transactions';
import { convertToClarityValue, decodeClarityValues, SimplifiedClarityValue } from './utils/clarity-responses-util';

// export the Durable Object classes we're using
export { BnsApiDO, HiroApiDO, StxCityDO, SupabaseDO, ContractCallsDO };

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const logger = Logger.getInstance(env);
		const startTime = Date.now();
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		// Generate a unique request ID for tracking this request through the system
		const requestId = logger.info(`Request started: ${method} ${path}`, {
			path,
			method,
			userAgent: request.headers.get('User-Agent'),
			contentType: request.headers.get('Content-Type'),
		});

		try {
			// Handle CORS preflight requests
			if (method === 'OPTIONS') {
				return new Response(null, {
					headers: corsHeaders(request.headers.get('Origin') || undefined),
				});
			}

			// Initialize config with environment
			const config = AppConfig.getInstance(env).getConfig();

			logger.debug(`Processing request: ${method} ${path}`, { requestId });

			if (path === '/') {
				const duration = Date.now() - startTime;
				logger.debug(`Request completed: ${method} ${path}`, { requestId, duration });
				return createSuccessResponse({
					message: `Welcome to the aibtcdev-api-cache! Supported services: ${config.SUPPORTED_SERVICES.join(', ')}`,
					requestId,
				});
			}

			// Initialize services
			const cacheService = new CacheService(env, config.CACHE_TTL, false);
			const cacheKeyService = new CacheKeyService('contract-calls');

			// For the Durable Object responses, the CORS headers will be added by the DO handlers
			try {
				if (path.startsWith('/bns')) {
					const id: DurableObjectId = env.BNS_API_DO.idFromName('bns-do'); // create the instance
					const stub = env.BNS_API_DO.get(id); // get the stub for communication
					return await stub.fetch(request); // forward the request to the Durable Object
				}

				if (path.startsWith('/hiro-api')) {
					const id: DurableObjectId = env.HIRO_API_DO.idFromName('hiro-api-do'); // create the instance
					const stub = env.HIRO_API_DO.get(id); // get the stub for communication
					return await stub.fetch(request); // forward the request to the Durable Object
				}

				if (path.startsWith('/stx-city')) {
					const id: DurableObjectId = env.STX_CITY_DO.idFromName('stx-city-do'); // create the instance
					const stub = env.STX_CITY_DO.get(id); // get the stub for communication
					return await stub.fetch(request); // forward the request to the Durable Object
				}

				if (path.startsWith('/supabase')) {
					let id: DurableObjectId = env.SUPABASE_DO.idFromName('supabase-do'); // create the instance
					let stub = env.SUPABASE_DO.get(id); // get the stub for communication
					return await stub.fetch(request); // forward the request to the Durable Object
				}

				if (path.startsWith('/contract-calls')) {
					// Fast-path cache check for read-only endpoints
					let useFastPath = false;
					if (path.startsWith('/contract-calls/read-only/') && method === 'POST') {
						try {
							const body = await request.clone().json() as ContractCallRequest;
							const bustCache = body.cacheControl?.bustCache || false;

							if (!bustCache) {
								// Parse path to extract contract details
								const endpoint = path.replace('/contract-calls/read-only/', '');
								const parts = endpoint.split('/').filter(Boolean);
								if (parts.length !== 3) {
									throw new ApiError(ErrorCode.INVALID_REQUEST, {
										reason: 'Invalid read-only endpoint format. Use /read-only/{contractAddress}/{contractName}/{functionName}',
									});
								}
								const [contractAddress, contractName, functionName] = parts;

								// Convert arguments to ClarityValues
								const rawFunctionArgs = body.functionArgs || [];
								const functionArgs = rawFunctionArgs.map(arg => convertToClarityValue(arg as ClarityValue | SimplifiedClarityValue));

								const network = body.network || 'testnet';

								// Generate cache key
								const cacheKey = cacheKeyService.generateContractCallKey(
									contractAddress,
									contractName,
									functionName,
									functionArgs,
									network
								);

								// Check cache
								const cached = await cacheService.get<ClarityValue>(cacheKey);
								if (cached) {
									const strictJsonCompat = body.strictJsonCompat !== false;
									const preserveContainers = body.preserveContainers || false;
									const decoded = decodeClarityValues(cached, strictJsonCompat, preserveContainers);

									// Log cache hit
									logger.debug(`Cache hit for contract call: ${contractAddress}.${contractName}::${functionName}`, {
										requestId,
										cacheKey,
										network,
									});

									return new Response(JSON.stringify({ success: true, data: decoded }), {
										status: 200,
										headers: {
											...corsHeaders(request.headers.get('Origin') || undefined),
											'Content-Type': 'application/json',
										},
									});
								}
							}
						} catch (error) {
							// If fast-path fails (e.g., invalid body), fall back to DO routing with logging
							logger.warn(`Fast-path cache check failed, falling back to DO`, {
								requestId,
								path,
								error: error instanceof Error ? error.message : String(error),
							});
						}
					}

					// Route to a round-robin selected DO
					const doNames = AppConfig.getInstance(env).getHiroDoNames();
					if (doNames.length === 0) {
						throw new ApiError(ErrorCode.INTERNAL_ERROR, { reason: 'No Durable Object names configured' });
					}

					// Get and increment counter for round-robin
					let counter = (await cacheService.get<number>('hiro_rr_counter')) || 0;
					const index = counter % doNames.length;
					const name = doNames[index];

					// Increment counter (fire-and-forget, no await to avoid blocking)
					cacheService.set('hiro_rr_counter', counter + 1, 0).catch(err => {
						logger.error(`Failed to update round-robin counter`, err instanceof Error ? err : new Error(String(err)));
					});

					const id = env.CONTRACT_CALLS_DO.idFromName(name);
					const stub = env.CONTRACT_CALLS_DO.get(id);

					// Log the selected DO
					logger.debug(`Routing to DO: ${name}`, {
						requestId,
						path,
						doIndex: index,
						totalDOs: doNames.length,
					});

					return await stub.fetch(request);
				}
			} catch (error) {
				// Log errors from Durable Objects
				const duration = Date.now() - startTime;
				logger.error(`Error in Durable Object request: ${method} ${path}`, error instanceof Error ? error : new Error(String(error)), {
					requestId,
					duration,
					service: path.split('/')[1], // Extract service name from path
				});
				throw error; // Re-throw to be handled by the outer try/catch
			}

			// If we get here, the path doesn't match any supported service
			throw new ApiError(ErrorCode.NOT_FOUND, {
				resource: path,
				supportedServices: config.SUPPORTED_SERVICES,
			});
		} catch (error) {
			const duration = Date.now() - startTime;

			// Log the error if it hasn't been logged already
			if (!(error instanceof ApiError)) {
				logger.error(`Unhandled exception: ${method} ${path}`, error instanceof Error ? error : new Error(String(error)), {
					requestId,
					duration,
					path,
					method,
					errorType: error instanceof Error ? error.constructor.name : typeof error,
				});
			}

			// Return appropriate error response with request ID
			if (error instanceof ApiError) {
				error.details = {
					...error.details,
					requestId,
				};
			}
			return createErrorResponse(error);
		} finally {
			const duration = Date.now() - startTime;
			if (duration > 1000) {
				logger.warn(`Slow request: ${method} ${path}`, {
					requestId,
					duration,
					threshold: 1000,
				});
			} else {
				logger.debug(`Request completed: ${method} ${path}`, {
					requestId,
					duration,
				});
			}
		}
	},
} satisfies ExportedHandler<Env>;

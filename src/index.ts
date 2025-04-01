import { Env } from '../worker-configuration';
import { AppConfig } from './config';
import { BnsApiDO } from './durable-objects/bns-do';
import { HiroApiDO } from './durable-objects/hiro-api-do';
import { StxCityDO } from './durable-objects/stx-city-do';
import { SupabaseDO } from './durable-objects/supabase-do';
import { ContractCallsDO } from './durable-objects/contract-calls-do';
import { corsHeaders, createErrorResponse, createSuccessResponse } from './utils/requests-responses-util';
import { ApiError } from './utils/api-error-util';
import { ErrorCode } from './utils/error-catalog-util';
import { Logger } from './utils/logger-util';

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
					let id: DurableObjectId = env.CONTRACT_CALLS_DO.idFromName('contract-calls-do'); // create the instance
					let stub = env.CONTRACT_CALLS_DO.get(id); // get the stub for communication
					return await stub.fetch(request); // forward the request to the Durable Object
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

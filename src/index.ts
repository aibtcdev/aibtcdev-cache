import { Env } from '../worker-configuration';
import { AppConfig } from './config';
import { corsHeaders, createJsonResponse } from './utils/requests-responses';
import { BnsApiDO } from './durable-objects/bns-do';
import { HiroApiDO } from './durable-objects/hiro-api-do';
import { StxCityDO } from './durable-objects/stx-city-do';
import { SupabaseDO } from './durable-objects/supabase-do';
import { ContractCallsDO } from './durable-objects/contract-calls-do';

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
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: corsHeaders(request.headers.get('Origin') || undefined),
			});
		}

		// Initialize config with environment
		const config = AppConfig.getInstance(env).getConfig();
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === '/') {
			return createJsonResponse({
				message: `Welcome to the aibtcdev-api-cache! Supported services: ${config.SUPPORTED_SERVICES.join(', ')}`,
			});
		}

		// For the Durable Object responses, the CORS headers will be added by the DO handlers

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

		// Return 404 for any other path
		return createJsonResponse(
			{
				error: `Unsupported service at: ${path}, supported services: ${config.SUPPORTED_SERVICES.join(', ')}`,
			},
			404
		);
	},
} satisfies ExportedHandler<Env>;

import { Env } from '../worker-configuration';
import { AppConfig } from './config';
import { HiroApiDO } from './durable-objects/hiro-api-do';
import { SupabaseDO } from './durable-objects/supabase-do';

// export the Durable Object classes we're using
export { HiroApiDO };
export { SupabaseDO };

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
		// Initialize config with environment
		const config = AppConfig.getInstance(env).getConfig();
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === '/') {
			return new Response(
				JSON.stringify({
					message: `Welcome to the aibtcdev-api-cache! Supported services: ${config.SUPPORTED_SERVICES.join(', ')}`,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		if (path.startsWith('/hiro-api')) {
			const id: DurableObjectId = env.HIRO_API_DO.idFromName('hiro-api-do'); // create the instance
			const stub = env.HIRO_API_DO.get(id); // get the stub for communication
			return await stub.fetch(request); // forward the request to the Durable Object
		}

		if (path.startsWith('/supabase')) {
			let id: DurableObjectId = env.SUPABASE_DO.idFromName('supabase-do'); // create the instance
			let stub = env.SUPABASE_DO.get(id); // get the stub for communication
			return await stub.fetch(request); // forward the request to the Durable Object
		}

		// Return 404 for any other path
		return new Response(
			JSON.stringify({
				error: `Invalid path: ${path}. Supported services: ${config.SUPPORTED_SERVICES.join(', ')}`,
			}),
			{
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	},
} satisfies ExportedHandler<Env>;

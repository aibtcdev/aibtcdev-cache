import { Env } from '../worker-configuration';
import { HiroApiDO } from './durable-objects/hiro-api-do';
export { HiroApiDO };

const supportedServices = ['/hiro-api'];

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === '/') {
			return new Response(
				JSON.stringify({
					message: `Welcome to the aibtcdev-api-cache! Supported services: ${supportedServices.join(', ')}`,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		if (path.startsWith('/hiro-api')) {
			// Create a DurableObjectId for our instance
			let id: DurableObjectId = env.HIRO_API_DO.idFromName('hiro-api-do');

			// Get the stub for communication
			let stub = env.HIRO_API_DO.get(id);

			// Forward the request to the Durable Object
			return await stub.fetch(request);
		}

		// Return 404 for any other path
		return new Response(
			JSON.stringify({
				error: `Invalid path: ${path}. Supported services: ${supportedServices.join(', ')}`,
			}),
			{
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	},
} satisfies ExportedHandler<Env>;

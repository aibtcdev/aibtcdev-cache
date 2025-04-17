import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { handleRequest } from '../utils/request-handler-util';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { Logger } from '../utils/logger-util';

export class ChainhooksDO extends DurableObject<Env> {
	// Configuration constants
	private readonly BASE_PATH: string = '/chainhooks';
	private readonly CACHE_PREFIX: string = this.BASE_PATH.replaceAll('/', '');
	private readonly SUPPORTED_ENDPOINTS: string[] = ['/post-event'];

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx = ctx;
		this.env = env;

		// Initialize AppConfig with environment
		const config = AppConfig.getInstance(env).getConfig();
	}

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

				// Handle post-event endpoint
				if (endpoint === '/post-event') {
					if (method !== 'POST') {
						throw new ApiError(ErrorCode.INVALID_REQUEST, {
							reason: `Method ${method} not allowed for this endpoint. Use POST.`,
						});
					}

					return await this.handlePostEvent(request);
				}

				// If we get here, the endpoint is not supported
				throw new ApiError(ErrorCode.NOT_FOUND, {
					resource: endpoint,
					supportedEndpoints: this.SUPPORTED_ENDPOINTS,
				});
			},
			this.env,
			{
				path,
				method,
			}
		);
	}

	private async handlePostEvent(request: Request): Promise<any> {
		const logger = Logger.getInstance(this.env);

		try {
			// Clone the request to read the body
			const clonedRequest = request.clone();

			// Try to parse as JSON first
			let body;
			try {
				body = await clonedRequest.json();
			} catch (e) {
				// If JSON parsing fails, get the body as text
				body = await request.text();
			}

			// Log the received event
			logger.info('Received chainhook event', {
				body,
				headers: Object.fromEntries(request.headers.entries()),
			});

			// Store the event in Durable Object storage for later analysis
			const eventId = crypto.randomUUID();
			await this.ctx.storage.put(`event_${eventId}`, {
				timestamp: new Date().toISOString(),
				body,
				headers: Object.fromEntries(request.headers.entries()),
			});

			return {
				message: 'Event received and logged successfully',
				eventId,
			};
		} catch (error) {
			logger.error('Error processing chainhook event', error instanceof Error ? error : new Error(String(error)));
			throw new ApiError(ErrorCode.INTERNAL_ERROR, {
				reason: 'Failed to process chainhook event',
			});
		}
	}
}

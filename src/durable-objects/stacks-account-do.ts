import { DurableObject } from 'cloudflare:workers';
import { Env } from '../../worker-configuration';
import { AppConfig } from '../config';
import { StacksAccountDataService } from '../services/stacks-account-data-service';
import { handleRequest } from '../utils/request-handler-util';
import { ApiError } from '../utils/api-error-util';
import { ErrorCode } from '../utils/error-catalog-util';
import { validateStacksAddress } from '@stacks/transactions';

export class StacksAccountDO extends DurableObject<Env> {
	private accountDataService: StacksAccountDataService;
	private address: string;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.env = env;
		this.address = ctx.id.toString();

		const config = AppConfig.getInstance(env).getConfig();
		const hiroConfig = config.HIRO_API_RATE_LIMIT;

		// Use Hiro API rate limits since we're hitting their endpoints
		this.accountDataService = new StacksAccountDataService(
			env,
			hiroConfig.MAX_REQUESTS_PER_INTERVAL,
			hiroConfig.INTERVAL_MS,
			config.MAX_RETRIES,
			config.RETRY_DELAY
		);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// e.g., /stacks-account/{address}/nonce -> /nonce
		const endpoint = url.pathname.replace(`/stacks-account/${this.address}`, '') || '/';
		const method = request.method;

		return handleRequest(
			async () => {
				if (!validateStacksAddress(this.address)) {
					throw new ApiError(ErrorCode.INVALID_CONTRACT_ADDRESS, { address: this.address });
				}

				// Route to different functions based on the endpoint
				if (endpoint.startsWith('/nonce')) {
					return this.handleNonceRequest(request, endpoint);
				}

				// Default response for the root of the DO
				if (endpoint === '/') {
					return { message: `StacksAccountDO for ${this.address}. Supported endpoints: /nonce` };
				}

				throw new ApiError(ErrorCode.NOT_FOUND, { resource: endpoint });
			},
			this.env,
			{ path: url.pathname, method }
		);
	}

	private async handleNonceRequest(request: Request, endpoint: string): Promise<{ nonce: number }> {
		const url = new URL(request.url);
		const method = request.method;

		if (endpoint === '/nonce' && method === 'GET') {
			const bustCache = url.searchParams.get('bustCache') === 'true';
			return this.getNonce(bustCache);
		}

		if (endpoint === '/nonce/sync' && method === 'POST') {
			return this.syncNonce();
		}



		if (endpoint === '/nonce/update' && method === 'POST') {
			const { nonce } = (await request.json()) as { nonce: number };
			if (typeof nonce !== 'number') {
				throw new ApiError(ErrorCode.INVALID_ARGUMENTS, { reason: 'Nonce must be a number' });
			}
			return this.updateNonce(nonce);
		}

		throw new ApiError(ErrorCode.INVALID_REQUEST, { reason: `Method ${method} not supported for ${endpoint}` });
	}

	private async getNonce(bustCache: boolean): Promise<{ nonce: number }> {
		if (!bustCache) {
			const storedNonce = await this.ctx.storage.get<number>('nonce');
			if (storedNonce !== undefined) {
				return { nonce: storedNonce };
			}
		}
		// If cache is busted or nonce is not in storage, sync it
		return this.syncNonce();
	}

	private async syncNonce(): Promise<{ nonce: number }> {
		const nonce = await this.accountDataService.fetchNonce(this.address);
		await this.ctx.storage.put('nonce', nonce);
		return { nonce };
	}

	private async updateNonce(nonce: number): Promise<{ nonce: number }> {
		await this.ctx.storage.put('nonce', nonce);
		return { nonce };
	}
}

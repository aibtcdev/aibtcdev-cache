import { ApiError } from './api-error';
import { createSuccessResponse, createErrorResponse } from './requests-responses-util';
import { Logger } from './logger';
import { Env } from '../../worker-configuration';

/**
 * Wraps a request handler function with standardized error handling and performance tracking
 *
 * @param handler - The async function that handles the request
 * @param env - The environment for logging
 * @param options - Optional configuration for the handler
 * @returns A Response object
 */
export async function handleRequest<T>(
	handler: () => Promise<T>,
	env?: Env,
	options: {
		slowThreshold?: number; // Time in ms after which a request is considered slow
	} = {}
): Promise<Response> {
	const logger = Logger.getInstance(env);
	const startTime = Date.now();
	const requestId = logger.info('Request started');

	try {
		const result = await handler();
		const duration = Date.now() - startTime;

		// Log performance information
		const slowThreshold = options.slowThreshold || 1000; // Default to 1 second
		if (duration > slowThreshold) {
			logger.warn(`Slow request completed`, { requestId, duration });
		} else {
			logger.debug(`Request completed`, { requestId, duration });
		}

		return createSuccessResponse(result);
	} catch (error) {
		const duration = Date.now() - startTime;

		// Log the error with duration information
		if (error instanceof ApiError) {
			logger.warn(`API Error: ${error.code} - ${error.message}`, { requestId, errorId: error.id, ...error.details }, duration);
		} else {
			const errorObj = error instanceof Error ? error : new Error(String(error));
			logger.error('Unhandled exception', errorObj, { requestId }, duration);
		}

		// Return appropriate error response
		return createErrorResponse(error);
	}
}

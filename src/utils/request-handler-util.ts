import { Env } from '../../worker-configuration';
import { ApiError } from './api-error-util';
import { Logger } from './logger-util';
import { createSuccessResponse, createErrorResponse } from './requests-responses-util';

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
		path?: string; // The request path for better logging
		method?: string; // The HTTP method for better logging
	} = {}
): Promise<Response> {
	const logger = Logger.getInstance(env);
	const startTime = Date.now();
	const requestId = logger.info(`Request started: ${options.method || 'UNKNOWN'} ${options.path || 'unknown'}`, {
		path: options.path || 'unknown',
		method: options.method || 'UNKNOWN',
	});

	try {
		const result = await handler();
		const duration = Date.now() - startTime;

		// Log performance information
		const slowThreshold = options.slowThreshold || 1000; // Default to 1 second
		if (duration > slowThreshold) {
			logger.warn(`Slow request: ${options.method || 'UNKNOWN'} ${options.path || 'unknown'}`, {
				requestId,
				duration,
				threshold: slowThreshold,
			});
		} else {
			logger.debug(`Request completed: ${options.method || 'UNKNOWN'} ${options.path || 'unknown'}`, {
				requestId,
				duration,
			});
		}

		return createSuccessResponse(result);
	} catch (error) {
		const duration = Date.now() - startTime;

		// Log the error with duration information
		if (error instanceof ApiError) {
			logger.warn(`API Error: ${error.code} - ${error.message}`, {
				requestId,
				errorId: error.id,
				path: options.path || 'unknown',
				method: options.method || 'UNKNOWN',
				duration,
				...error.details,
			});
		} else {
			const errorObj = error instanceof Error ? error : new Error(String(error));
			logger.error(`Unhandled exception: ${options.method || 'UNKNOWN'} ${options.path || 'unknown'}`, errorObj, {
				requestId,
				duration,
				errorType: error instanceof Error ? error.constructor.name : typeof error,
			});
		}

		// Return appropriate error response
		return createErrorResponse(error);
	}
}

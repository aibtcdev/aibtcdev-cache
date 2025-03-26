import { ApiError } from './api-error-util';
import { ErrorCode } from './error-catalog-util';

/**
 * Error thrown when a request exceeds its timeout
 */
export class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TimeoutError';
	}
}

/**
 * Wraps a promise with a timeout
 *
 * @param promise - The promise to wrap with a timeout
 * @param timeoutMs - The timeout in milliseconds
 * @param errorMessage - Optional custom error message
 * @returns A promise that resolves with the original promise's result or rejects with a timeout error
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	errorMessage = `Operation timed out after ${timeoutMs}ms`
): Promise<T> {
	// Create a promise that rejects after the specified timeout
	const timeoutPromise = new Promise<never>((_, reject) => {
		const timeoutId = setTimeout(() => {
			clearTimeout(timeoutId);
			reject(new TimeoutError(errorMessage));
		}, timeoutMs);
	});

	// Race the original promise against the timeout
	try {
		return await Promise.race([promise, timeoutPromise]);
	} catch (error) {
		// Convert TimeoutError to ApiError for consistent error handling
		if (error instanceof TimeoutError) {
			throw new ApiError(ErrorCode.TIMEOUT_ERROR, {
				message: error.message,
				timeoutMs,
			});
		}
		throw error;
	}
}

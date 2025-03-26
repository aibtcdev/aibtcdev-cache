import { ApiError } from './api-error-util';

/**
 * Generates a unique error ID for tracking purposes
 */
function generateErrorId(): string {
	// Use crypto.randomUUID() if available
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID().split('-')[0]; // Use first segment for brevity
	}

	// Fallback to timestamp + random string
	return Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
}

/**
 * Creates CORS headers for cross-origin requests
 *
 * @param origin - Optional origin to allow, defaults to '*' (all origins)
 * @returns HeadersInit object with CORS headers
 */
export function corsHeaders(origin?: string): HeadersInit {
	return {
		'Access-Control-Allow-Origin': origin || '*',
		'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400',
	};
}

/**
 * Standard response format for all API responses
 */
interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: {
		id: string;
		code: string;
		message: string;
		details?: Record<string, any>;
	};
}

/**
 * Creates a standardized success response
 */
export function createSuccessResponse<T>(data: T, status = 200): Response {
	const body: ApiResponse<T> = {
		success: true,
		data,
	};

	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders(),
		},
	});
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(error: unknown): Response {
	let body: ApiResponse<never>;
	let status = 500;

	if (error instanceof ApiError) {
		body = {
			success: false,
			error: {
				id: error.id,
				code: error.code,
				message: error.message,
				details: error.details,
			},
		};
		status = error.status;
	} else {
		// Generate an error ID for non-ApiError errors
		const errorId = generateErrorId();
		const errorMessage = error instanceof Error ? error.message : String(error);
		body = {
			success: false,
			error: {
				id: errorId,
				code: 'INTERNAL_ERROR',
				message: errorMessage || 'An unexpected error occurred',
			},
		};
	}

	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders(),
		},
	});
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use createSuccessResponse or createErrorResponse instead
 */
export function createJsonResponse(body: unknown, status = 200): Response {
	console.warn('createJsonResponse is deprecated. Use createSuccessResponse or createErrorResponse instead.');
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders(),
		},
	});
}

/**
 * Stringifies a value with special handling for BigInt values
 *
 * @param value - The value to stringify
 * @param replacer - Optional replacer function for JSON.stringify
 * @param space - Optional space parameter for JSON.stringify formatting
 * @returns JSON string with BigInt values converted to strings with 'n' suffix
 */
export function stringifyWithBigInt(value: unknown, replacer?: (key: string, value: unknown) => unknown, space?: string | number): string {
	const customReplacer = (key: string, val: unknown): unknown => {
		if (typeof val === 'bigint') {
			return val.toString() + 'n'; // Convert BigInt to string with 'n' suffix
		}
		if (replacer && typeof replacer === 'function') {
			return replacer(key, val);
		}
		return val;
	};
	return JSON.stringify(value, customReplacer, space);
}

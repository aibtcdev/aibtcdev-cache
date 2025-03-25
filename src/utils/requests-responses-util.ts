import { ApiError } from './api-error';

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
    data
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
        code: error.code,
        message: error.message,
        details: error.details
      }
    };
    status = error.status;
  } else {
    const errorMessage = error instanceof Error ? error.message : String(error);
    body = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: errorMessage || 'An unexpected error occurred'
      }
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

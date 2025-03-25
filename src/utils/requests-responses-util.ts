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
 * Creates a JSON response with appropriate headers
 * 
 * @param body - The response body (will be stringified if not already a string)
 * @param status - HTTP status code, defaults to 200
 * @returns Response object with JSON content type and CORS headers
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

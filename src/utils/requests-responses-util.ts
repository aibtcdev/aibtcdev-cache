export function corsHeaders(origin?: string): HeadersInit {
	return {
		'Access-Control-Allow-Origin': origin || '*',
		'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400',
	};
}

export function createJsonResponse(body: unknown, status = 200): Response {
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders(),
		},
	});
}

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

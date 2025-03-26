import { ErrorCode, ErrorMessages, ErrorStatusCodes } from './error-catalog-util';

/**
 * Standard API error class used throughout the application
 */
export class ApiError extends Error {
	code: ErrorCode;
	status: number;
	details?: Record<string, any>;
	id: string;

	/**
	 * Create a new API error
	 *
	 * @param code - Error code from the ErrorCode enum
	 * @param details - Optional details to include in the error message
	 * @param id - Optional error ID (generated if not provided)
	 */
	constructor(code: ErrorCode, details?: Record<string, any>, id?: string) {
		// Get the message template for this error code
		let message = ErrorMessages[code];

		// Replace placeholders with values from details
		if (details) {
			Object.entries(details).forEach(([key, value]) => {
				message = message.replace(`{${key}}`, String(value));
			});
		}

		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = ErrorStatusCodes[code];
		this.details = details;

		// Generate or use provided error ID
		this.id = id || this.generateId();
	}

	/**
	 * Generates a unique error ID
	 */
	private generateId(): string {
		// Use crypto.randomUUID() if available
		if (typeof crypto !== 'undefined' && crypto.randomUUID) {
			return crypto.randomUUID().split('-')[0]; // Use first segment for brevity
		}

		// Fallback to timestamp + random string
		return Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
	}
}

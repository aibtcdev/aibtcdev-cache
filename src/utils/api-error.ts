import { ErrorCode, ErrorMessages, ErrorStatusCodes } from './error-catalog';

/**
 * Standard API error class used throughout the application
 */
export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  details?: Record<string, any>;
  
  /**
   * Create a new API error
   * 
   * @param code - Error code from the ErrorCode enum
   * @param details - Optional details to include in the error message
   */
  constructor(code: ErrorCode, details?: Record<string, any>) {
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
  }
}

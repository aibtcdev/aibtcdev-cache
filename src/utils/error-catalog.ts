/**
 * Standardized error codes used throughout the application
 */
export enum ErrorCode {
  // General errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  
  // API specific errors
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  UPSTREAM_API_ERROR = 'UPSTREAM_API_ERROR',
  
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_CONTRACT_ADDRESS = 'INVALID_CONTRACT_ADDRESS',
  INVALID_FUNCTION = 'INVALID_FUNCTION',
  INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
  
  // Cache errors
  CACHE_ERROR = 'CACHE_ERROR',
  
  // Configuration errors
  CONFIG_ERROR = 'CONFIG_ERROR'
}

/**
 * Error message templates for each error code
 * Use {placeholders} for dynamic content
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCode.INTERNAL_ERROR]: 'An internal error occurred',
  [ErrorCode.NOT_FOUND]: 'Resource not found: {resource}',
  [ErrorCode.INVALID_REQUEST]: 'Invalid request: {reason}',
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized access',
  
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded. Try again in {retryAfter} seconds',
  [ErrorCode.UPSTREAM_API_ERROR]: 'Upstream API error: {message}',
  
  [ErrorCode.VALIDATION_ERROR]: 'Validation error: {message}',
  [ErrorCode.INVALID_CONTRACT_ADDRESS]: 'Invalid contract address: {address}',
  [ErrorCode.INVALID_FUNCTION]: 'Function {function} not found in contract {contract}',
  [ErrorCode.INVALID_ARGUMENTS]: 'Invalid arguments for function {function}: {reason}',
  
  [ErrorCode.CACHE_ERROR]: 'Cache operation failed: {reason}',
  
  [ErrorCode.CONFIG_ERROR]: 'Configuration error: {reason}'
};

/**
 * HTTP status codes associated with each error code
 */
export const ErrorStatusCodes: Record<ErrorCode, number> = {
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.INVALID_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.UPSTREAM_API_ERROR]: 502,
  
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_CONTRACT_ADDRESS]: 400,
  [ErrorCode.INVALID_FUNCTION]: 400,
  [ErrorCode.INVALID_ARGUMENTS]: 400,
  
  [ErrorCode.CACHE_ERROR]: 500,
  
  [ErrorCode.CONFIG_ERROR]: 500
};

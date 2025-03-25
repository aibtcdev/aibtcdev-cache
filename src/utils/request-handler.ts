import { ApiError } from './api-error';
import { createSuccessResponse, createErrorResponse } from './requests-responses-util';
import { Logger } from './logger';
import { Env } from '../../worker-configuration';

/**
 * Wraps a request handler function with standardized error handling
 * 
 * @param handler - The async function that handles the request
 * @param env - The environment for logging
 * @returns A Response object
 */
export async function handleRequest<T>(
  handler: () => Promise<T>,
  env?: Env
): Promise<Response> {
  const logger = Logger.getInstance(env);
  
  try {
    const result = await handler();
    return createSuccessResponse(result);
  } catch (error) {
    // Log the error
    if (error instanceof ApiError) {
      logger.warn(`API Error: ${error.code} - ${error.message}`, error.details);
    } else {
      logger.error('Unhandled exception', error instanceof Error ? error : new Error(String(error)));
    }
    
    // Return appropriate error response
    return createErrorResponse(error);
  }
}

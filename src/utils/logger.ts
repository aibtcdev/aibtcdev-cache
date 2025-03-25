import { Env } from '../../worker-configuration';

/**
 * Log levels in order of increasing severity
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

/**
 * Interface for structured log entries
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  error?: Error;
}

/**
 * Simple logger that writes to console and optionally to KV
 */
export class Logger {
  private static instance: Logger;
  private env?: Env;
  private readonly LOG_KEY_PREFIX = 'logs_';
  private readonly MAX_LOG_AGE = 604800; // 1 week in seconds (7 * 24 * 60 * 60)
  
  private constructor() {}
  
  /**
   * Get the singleton logger instance
   */
  public static getInstance(env?: Env): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    
    // Update env if provided
    if (env) {
      Logger.instance.env = env;
    }
    
    return Logger.instance;
  }
  
  /**
   * Log a message at the specified level
   */
  public log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } as Error : undefined
    };
    
    // Always log to console
    this.logToConsole(entry);
    
    // Optionally log to KV if environment is available
    if (this.env && (level === LogLevel.ERROR || level === LogLevel.WARN)) {
      this.logToKV(entry).catch(err => {
        console.error('Failed to write log to KV:', err);
      });
    }
  }
  
  /**
   * Log to console with appropriate formatting
   */
  private logToConsole(entry: LogEntry): void {
    const { level, message, context, error } = entry;
    
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    const baseMessage = `[${level}] ${message}${contextStr}`;
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(baseMessage);
        break;
      case LogLevel.INFO:
        console.info(baseMessage);
        break;
      case LogLevel.WARN:
        console.warn(baseMessage);
        break;
      case LogLevel.ERROR:
        console.error(baseMessage);
        if (error) {
          console.error(error);
        }
        break;
    }
  }
  
  /**
   * Log to KV storage for persistence
   */
  private async logToKV(entry: LogEntry): Promise<void> {
    if (!this.env) return;
    
    const key = `${this.LOG_KEY_PREFIX}${entry.timestamp}_${Math.random().toString(36).substring(2, 9)}`;
    
    await this.env.AIBTCDEV_CACHE_KV.put(
      key, 
      JSON.stringify(entry),
      { expirationTtl: this.MAX_LOG_AGE }
    );
  }
  
  // Convenience methods
  public debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }
  
  public info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }
  
  public warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }
  
  public error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }
}

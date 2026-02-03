/**
 * Logger
 * Human-readable structured logging with sync summaries
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  dataObject?: string;
  jobId?: string;
  [key: string]: unknown;
}

export interface SyncSummary {
  dataObject: string;
  processed: number;
  succeeded: number;
  failed: number;
  unchanged: number;
  duration: number;
}

/**
 * Format a timestamp for logging
 */
function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Format a log level for display
 */
function formatLevel(level: LogLevel): string {
  return level.toUpperCase().padEnd(5);
}

/**
 * Format context as a tag
 */
function formatContext(context?: LogContext): string {
  if (!context?.dataObject) return '';
  return `[${context.dataObject}] `;
}

/**
 * Logger class with support for structured logging
 */
class Logger {
  private minLevel: LogLevel = 'info';
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Check if a level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  /**
   * Format and output a log message
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const timestamp = formatTimestamp();
    const levelStr = formatLevel(level);
    const contextStr = formatContext(context);

    const output = `[${timestamp}] [${levelStr}] ${contextStr}${message}`;

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /**
   * Log an error with stack trace
   */
  errorWithStack(message: string, error: Error, context?: LogContext): void {
    this.error(message, context);
    if (error.stack) {
      console.error(error.stack);
    }
  }

  /**
   * Log the start of a sync operation
   */
  syncStart(dataObject: string): void {
    this.info('Sync started', { dataObject });
  }

  /**
   * Log the completion of a sync operation with summary
   */
  syncComplete(summary: SyncSummary): void {
    const { dataObject, processed, succeeded, failed, unchanged, duration } = summary;
    const durationStr = (duration / 1000).toFixed(1);

    // Format the summary line
    const parts: string[] = [];
    if (succeeded > 0) parts.push(`${succeeded} synced`);
    if (unchanged > 0) parts.push(`${unchanged} unchanged`);
    if (failed > 0) parts.push(`${failed} failed`);

    const summaryStr = parts.length > 0 
      ? `${processed} processed: ${parts.join(', ')}`
      : `${processed} processed`;

    this.info(`${summaryStr}`, { dataObject });
    this.info(`Sync completed in ${durationStr}s`, { dataObject });
  }

  /**
   * Log a sync failure for a specific item
   */
  syncItemFailed(dataObject: string, itemId: string, reason: string): void {
    this.error(`${itemId}: Failed - ${reason}`, { dataObject });
  }

  /**
   * Log a sync success for a specific item (debug level)
   */
  syncItemSuccess(dataObject: string, itemId: string, action: 'created' | 'updated' | 'deleted'): void {
    this.debug(`${itemId}: ${action}`, { dataObject });
  }

  /**
   * Log webhook received
   */
  webhookReceived(topic: string, shopifyId: string): void {
    this.info(`Webhook received: ${topic} for ${shopifyId}`);
  }

  /**
   * Log scheduler heartbeat
   */
  heartbeat(scheduledObjects: string[]): void {
    if (scheduledObjects.length > 0) {
      this.debug(`Heartbeat: scheduling ${scheduledObjects.join(', ')}`);
    }
  }

  /**
   * Log startup message
   */
  startup(mode: string, port: number): void {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                      SWITCHBOARD                           ║');
    console.log('║          Shopify Integration Layer v1.0.0                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    this.info(`Starting in ${mode.toUpperCase()} mode`);
    this.info(`Webhook server listening on port ${port}`);
    console.log('');
  }

  /**
   * Log shutdown message
   */
  shutdown(): void {
    console.log('');
    this.info('Shutting down gracefully...');
  }

  /**
   * Log configuration loaded
   */
  configLoaded(enabledObjects: string[]): void {
    this.info(`Configuration loaded. Enabled data objects: ${enabledObjects.join(', ')}`);
  }

  /**
   * Log database initialized
   */
  dbInitialized(reset: boolean): void {
    if (reset) {
      this.info('Database reset for demo mode');
    } else {
      this.info('Database connection established');
    }
  }

  /**
   * Create a child logger with preset context
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context);
  }
}

/**
 * Child logger with preset context
 */
class ChildLogger {
  constructor(
    private parent: Logger,
    private context: LogContext
  ) {}

  debug(message: string): void {
    this.parent.debug(message, this.context);
  }

  info(message: string): void {
    this.parent.info(message, this.context);
  }

  warn(message: string): void {
    this.parent.warn(message, this.context);
  }

  error(message: string): void {
    this.parent.error(message, this.context);
  }

  errorWithStack(message: string, error: Error): void {
    this.parent.errorWithStack(message, error, this.context);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export types
export type { ChildLogger };

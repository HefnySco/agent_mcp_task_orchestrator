import fs from 'fs/promises';
import path from 'path';
import { getConfigManager } from './config.js';
import type { LogEntry } from './types.js';
import { FILE_CONFIG } from './constants.js';

/**
 * Log level enumeration
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

/**
 * Logger interface for structured logging
 */
export class Logger {
  private outputDir: string;
  private logLevel: LogLevel;
  private writeQueue: Promise<void> = Promise.resolve();
  private fileLoggingEnabled: boolean;

  constructor() {
    const config = getConfigManager();
    this.outputDir = config.getOutputDir();
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO;
    this.fileLoggingEnabled = process.env.TASK_ORCHESTRATOR_LOG === 'true';
    if (this.fileLoggingEnabled) {
      this.ensureOutputDir();
    }
  }

  /**
   * Ensure output directory exists
   */
  private async ensureOutputDir(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create output directory:', err);
    }
  }

  /**
   * Format log message
   */
  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  /**
   * Write log to file
   */
  private async writeToFile(entry: LogEntry): Promise<void> {
    if (!this.fileLoggingEnabled) {
      return;
    }

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const timestamp = new Date().toISOString();
        const dateStr = timestamp.split('T')[0];
        const logFile = path.join(this.outputDir, `${FILE_CONFIG.LOG_FILE_PREFIX}${dateStr}${FILE_CONFIG.LOG_FILE_EXTENSION}`);

        let logs: LogEntry[] = [];
        try {
          const existing = await fs.readFile(logFile, 'utf-8');
          logs = JSON.parse(existing);
        } catch (err) {
          // File doesn't exist or is empty, start fresh
        }

        logs.push(entry);
        await fs.writeFile(logFile, JSON.stringify(logs, null, 2));
      } catch (err) {
        console.error('Failed to write log to file:', err);
      }
    });
    await this.writeQueue;
  }

  /**
   * Log error message
   */
  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formatted = this.formatMessage(LogLevel.ERROR, message, meta);
      console.error(formatted);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formatted = this.formatMessage(LogLevel.WARN, message, meta);
      console.warn(formatted);
    }
  }

  /**
   * Log info message
   */
  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formatted = this.formatMessage(LogLevel.INFO, message, meta);
      console.log(formatted);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formatted = this.formatMessage(LogLevel.DEBUG, message, meta);
      console.log(formatted);
    }
  }

  /**
   * Log MCP tool request
   */
  async logToolRequest(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    llmContext?: {
      llmMessage?: string;
    }
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type: 'tool_request',
      tool: toolName,
      arguments: args,
      result
    };

    await this.writeToFile(entry);
    this.debug(`Tool executed: ${toolName}`, { args, result });
  }

  /**
   * Log LLM response with tool calls
   */
  async logLLMResponse(
    message: string,
    toolCalls?: any[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type: 'llm_response',
      content: message,
      toolCalls,
      relatedTools: toolCalls?.map((tc: any) => tc.function?.name).filter(Boolean)
    };

    await this.writeToFile(entry);
    this.debug('LLM response logged', { messageLength: message.length, toolCalls: toolCalls?.length });
  }

  /**
   * Check if message should be logged based on log level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  /**
   * Set log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

/**
 * Get the singleton logger instance
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

/**
 * Reset the logger (for testing purposes)
 */
export function resetLogger(): void {
  loggerInstance = null;
}

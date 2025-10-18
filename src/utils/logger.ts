/**
 * Dev3000 Structured Logger
 *
 * Provides leveled logging with proper formatting and filtering.
 * Supports: ERROR, WARN, INFO, DEBUG, TRACE levels
 */

import chalk from "chalk"

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

export interface LoggerOptions {
  level?: LogLevel
  prefix?: string
  enableColors?: boolean
  enableTimestamp?: boolean
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.WARN]: "WARN",
  [LogLevel.INFO]: "INFO",
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.TRACE]: "TRACE"
}

const LOG_LEVEL_COLORS: Record<LogLevel, (text: string) => string> = {
  [LogLevel.ERROR]: chalk.red,
  [LogLevel.WARN]: chalk.yellow,
  [LogLevel.INFO]: chalk.cyan,
  [LogLevel.DEBUG]: chalk.gray,
  [LogLevel.TRACE]: chalk.dim
}

export class Logger {
  private level: LogLevel
  private prefix: string
  private enableColors: boolean
  private enableTimestamp: boolean

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? this.getLogLevelFromEnv()
    this.prefix = options.prefix ?? ""
    this.enableColors = options.enableColors ?? true
    this.enableTimestamp = options.enableTimestamp ?? false
  }

  /**
   * Get log level from environment variable DEV3000_LOG_LEVEL
   */
  private getLogLevelFromEnv(): LogLevel {
    const envLevel = process.env.DEV3000_LOG_LEVEL?.toUpperCase()
    switch (envLevel) {
      case "ERROR":
        return LogLevel.ERROR
      case "WARN":
        return LogLevel.WARN
      case "INFO":
        return LogLevel.INFO
      case "DEBUG":
        return LogLevel.DEBUG
      case "TRACE":
        return LogLevel.TRACE
      default:
        return LogLevel.INFO // Default to INFO
    }
  }

  /**
   * Set the current log level
   */
  setLevel(level: LogLevel): void {
    this.level = level
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.level
  }

  /**
   * Check if a given level should be logged
   */
  shouldLog(level: LogLevel): boolean {
    return level <= this.level
  }

  /**
   * Format a log message with optional timestamp and level
   */
  private format(level: LogLevel, message: string): string {
    const parts: string[] = []

    // Timestamp
    if (this.enableTimestamp) {
      const now = new Date()
      const timestamp = now.toISOString()
      parts.push(this.enableColors ? chalk.dim(timestamp) : timestamp)
    }

    // Level
    const levelName = LOG_LEVEL_NAMES[level]
    const levelStr = `[${levelName}]`.padEnd(7)
    parts.push(this.enableColors ? LOG_LEVEL_COLORS[level](levelStr) : levelStr)

    // Prefix
    if (this.prefix) {
      const prefixStr = `[${this.prefix}]`
      parts.push(this.enableColors ? chalk.magenta(prefixStr) : prefixStr)
    }

    // Message
    parts.push(message)

    return parts.join(" ")
  }

  /**
   * Log an error message
   */
  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.ERROR)) return
    const formatted = this.format(LogLevel.ERROR, message)
    console.error(formatted, ...args)
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.WARN)) return
    const formatted = this.format(LogLevel.WARN, message)
    console.warn(formatted, ...args)
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.INFO)) return
    const formatted = this.format(LogLevel.INFO, message)
    console.log(formatted, ...args)
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return
    const formatted = this.format(LogLevel.DEBUG, message)
    console.log(formatted, ...args)
  }

  /**
   * Log a trace message (most verbose)
   */
  trace(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.TRACE)) return
    const formatted = this.format(LogLevel.TRACE, message)
    console.log(formatted, ...args)
  }

  /**
   * Create a child logger with a different prefix
   */
  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix
    return new Logger({
      level: this.level,
      prefix: childPrefix,
      enableColors: this.enableColors,
      enableTimestamp: this.enableTimestamp
    })
  }

  /**
   * Log an object/data structure in a formatted way
   */
  logObject(level: LogLevel, label: string, obj: unknown): void {
    if (!this.shouldLog(level)) return

    const message = `${label}:`
    const formatted = this.format(level, message)
    console.log(formatted)

    if (typeof obj === "object" && obj !== null) {
      console.log(JSON.stringify(obj, null, 2))
    } else {
      console.log(obj)
    }
  }

  /**
   * Log structured data with key-value pairs
   */
  logFields(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    const formatted = this.format(level, message)
    console.log(formatted)

    for (const [key, value] of Object.entries(fields)) {
      const keyStr = this.enableColors ? chalk.cyan(`  ${key}:`) : `  ${key}:`
      console.log(`${keyStr} ${value}`)
    }
  }
}

/**
 * Parse log level from string
 */
export function parseLogLevel(level: string): LogLevel {
  const upperLevel = level.toUpperCase()
  switch (upperLevel) {
    case "ERROR":
      return LogLevel.ERROR
    case "WARN":
      return LogLevel.WARN
    case "INFO":
      return LogLevel.INFO
    case "DEBUG":
      return LogLevel.DEBUG
    case "TRACE":
      return LogLevel.TRACE
    default:
      throw new Error(`Invalid log level: ${level}. Valid levels: ERROR, WARN, INFO, DEBUG, TRACE`)
  }
}

/**
 * Global default logger instance
 */
export const defaultLogger = new Logger()

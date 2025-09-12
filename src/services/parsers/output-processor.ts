/**
 * Output processor that composes log format parsers and error detectors
 * Provides the main API for processing server log output
 */

import { LogFormatParser } from './log-parsers/index.js';
import { ErrorDetector } from './error-detectors/index.js';

/**
 * Log entry structure for processed output
 */
export interface LogEntry {
  formatted: string;      // Ready-to-log formatted message
  isCritical?: boolean;   // Optional flag for critical errors that should be shown to console
  rawMessage?: string;    // Optional raw message for critical error display
}

/**
 * Output processor that combines log format parsing and error detection
 * This is the main class that should be used for processing server log output
 */
export class OutputProcessor {
  constructor(
    private logFormatParser: LogFormatParser,
    private errorDetector: ErrorDetector
  ) {}

  /**
   * Process log text output from the server
   * @param text Raw log text to process
   * @param isError Whether this is from stderr (error stream)
   * @returns Array of processed log entries
   */
  process(text: string, isError: boolean = false): LogEntry[] {
    // First, parse the log format to extract structured information
    const parsedLines = this.logFormatParser.parse(text);

    // Then, apply error detection and create log entries
    return parsedLines.map(line => {
      // For error output, check if it's critical
      const isCritical = isError && this.errorDetector.isCritical(line.message);

      // Build the log entry
      const entry: LogEntry = {
        formatted: isError ? `ERROR: ${line.formatted}` : line.formatted,
      };

      // Add critical error information if applicable
      if (isCritical) {
        entry.isCritical = true;
        entry.rawMessage = line.message;
      }

      return entry;
    });
  }

  /**
   * Get the current log format parser
   */
  getLogFormatParser(): LogFormatParser {
    return this.logFormatParser;
  }

  /**
   * Get the current error detector
   */
  getErrorDetector(): ErrorDetector {
    return this.errorDetector;
  }
}

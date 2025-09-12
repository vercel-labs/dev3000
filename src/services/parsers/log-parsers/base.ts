/**
 * Base interfaces and types for log format parsers
 * Responsible for parsing log formats from different process managers
 */

/**
 * Parsed log line structure after format parsing
 */
export interface ParsedLogLine {
  formatted: string;     // Display format (e.g., "[WEB] Started GET /")
  message: string;       // Raw message for error detection (e.g., "Started GET /")
  processName?: string;  // Optional process identifier (e.g., "web", "js")
  metadata?: Record<string, any>;  // Additional metadata from parsing
}

/**
 * Base interface for log format parsers
 * Responsible for parsing the structure/format of server logs (timestamps, process names, etc.)
 */
export interface LogFormatParser {
  /**
   * Parse log text into structured lines
   * @param text Raw log text to parse
   * @returns Array of parsed log lines with formatting and metadata
   */
  parse(text: string): ParsedLogLine[];
}
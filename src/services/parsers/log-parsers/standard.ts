/**
 * Standard log parser for basic server logs
 * Handles standard server logs without special process manager formatting
 */

import { LogFormatParser, ParsedLogLine } from './base.js';

export class StandardLogParser implements LogFormatParser {
  parse(text: string): ParsedLogLine[] {
    if (!text || !text.trim()) {
      return [];
    }
    
    const lines = text.trim().split('\n').filter(Boolean);
    return lines.map(line => ({
      formatted: line,
      message: line,
    }));
  }
}
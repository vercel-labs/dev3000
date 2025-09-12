/**
 * Public API for the log parsers module
 * Only exposes what external consumers need
 */

// Main output processor and types
export {
  OutputProcessor,
  LogEntry,
} from './output-processor.js';

// Concrete implementations for Next.js
export { StandardLogParser } from './log-parsers/standard.js';
export { NextJsErrorDetector } from './error-detectors/nextjs.js';

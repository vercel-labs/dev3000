/**
 * Public API for the log parsers module
 * Only exposes what external consumers need
 */

export { NextJsErrorDetector } from "./error-detectors/nextjs.js"

// Concrete implementations for Next.js
export { StandardLogParser } from "./log-parsers/standard.js"
// Main output processor and types
export {
  LogEntry,
  OutputProcessor
} from "./output-processor.js"

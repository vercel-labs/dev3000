/**
 * Public API for the log parsers module
 * Only exposes what external consumers need
 */

export { NextJsErrorDetector } from "./error-detectors/nextjs.js"

// Concrete implementations for Next.js
export { StandardLogParser } from "./log-parsers/standard.js"
export type { LogEntry } from "./output-processor.js"
// Main output processor and types
export { OutputProcessor } from "./output-processor.js"

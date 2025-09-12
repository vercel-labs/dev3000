/**
 * Base interfaces and types for error detectors
 * Responsible for identifying critical errors in server output
 */

/**
 * Base interface for error detectors
 * Responsible for determining if a message indicates a critical error
 */
export interface ErrorDetector {
  /**
   * Check if a message indicates a critical error
   * @param message The raw message to check
   * @returns true if the message indicates a critical error
   */
  isCritical(message: string): boolean;
}

/**
 * Base error detector with common error patterns
 * Provides a foundation that specific framework detectors can extend
 */
export class BaseErrorDetector implements ErrorDetector {
  isCritical(message: string): boolean {
    // Common critical error patterns across all frameworks
    const criticalPatterns = [
      // Connection and port errors
      /EADDRINUSE/,                   // Port already in use
      /EACCES/,                       // Permission denied
      /ENOENT/,                       // File not found
      /ECONNREFUSED/,                 // Connection refused
      
      // System-level errors
      /out of memory/i,               // Memory issues
      /segmentation fault/i,          // Segfaults
      /stack overflow/i,              // Stack overflows
      
      // Generic fatal errors
      /FATAL/,                        // Fatal errors
      /PANIC/,                        // Panic conditions
      /SIGKILL/,                      // Process killed
      /SIGTERM/,                      // Process terminated
      
      // Module/dependency errors (but exclude warnings)
      /^(?!.*warning).*Cannot find module/i,      // Missing modules (exclude warnings)
      /^(?!.*warning).*Module not found/i,        // Missing modules (exclude warnings)  
      /^(?!.*warning).*Package not found/i,       // Missing packages (exclude warnings)
      
      // Syntax and parsing errors (but exclude warnings)
      /^(?!.*warning).*SyntaxError/i,             // Syntax errors (exclude warnings)
      /^(?!.*warning).*Parse error/i,             // Parse errors (exclude warnings)
      /^(?!.*warning).*Unexpected token/i,        // Parsing issues (exclude warnings)
    ];
    
    // Early return false for obvious non-critical patterns to avoid regex overhead
    if (/warning/i.test(message) || 
        /WARN/.test(message) || 
        /deprecated/i.test(message)) {
      return false;
    }
    
    // Check for critical patterns
    return criticalPatterns.some(pattern => pattern.test(message));
  }
}
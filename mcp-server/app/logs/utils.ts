import { LogEntry } from '@/types';

/**
 * Cleans up console log messages that contain CSS formatting directives
 * Example: "%c[Vercel Web Analytics]%c Debug mode... color: rgb(120, 120, 120) color: inherit"
 * Becomes: "[Vercel Web Analytics] Debug mode..."
 */
function cleanConsoleFormatting(message: string): string {
  // Pattern to match console log entries with CSS formatting
  const consoleLogPattern = /^\[CONSOLE LOG\] (.+)$/;
  const match = message.match(consoleLogPattern);
  
  if (!match) {
    return message;
  }
  
  let consoleMessage = match[1];
  
  // Check if this message has %c CSS formatting directives
  if (!consoleMessage.includes('%c')) {
    return message; // No formatting to clean
  }
  
  // Remove CSS formatting directives step by step
  let cleaned = consoleMessage;
  
  // Remove %c markers
  cleaned = cleaned.replace(/%c/g, '');
  
  // Remove trailing CSS color declarations - look for CSS patterns before JSON or at end of string
  // Match CSS color declarations that appear after %c removal
  cleaned = cleaned.replace(/\s+color:\s*[^{}\n]*?(?=\s*[\{[]|$)/g, '');
  
  // Clean up any extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return `[CONSOLE LOG] ${cleaned}`;
}

export function parseLogEntries(logContent: string): LogEntry[] {
  // Enhanced pattern to handle both formats:
  // Format 1 (CDP): [timestamp] [SOURCE] message  
  // Format 2 (Extension): [timestamp] [TAB-id] [SOURCE] [event] message
  const timestampPattern = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[([^\]]+)\] /;
  
  const entries: LogEntry[] = [];
  const lines = logContent.split('\n');
  let currentEntry: LogEntry | null = null;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const match = line.match(timestampPattern);
    if (match) {
      // Save previous entry if exists
      if (currentEntry) {
        entries.push(currentEntry);
      }
      
      const [fullMatch, timestamp, firstBracket] = match;
      const remainingLine = line.substring(fullMatch.length);
      
      // Check if this is a Chrome extension format with tab identifier
      const isTabIdentifier = /^TAB-\d+\.\d+$/.test(firstBracket);
      let source = firstBracket;
      let message = remainingLine;
      let tabIdentifier: string | undefined;
      let userAgent: string | undefined;
      
      if (isTabIdentifier) {
        // Chrome extension format: [TAB-id] [SOURCE] [event] message
        tabIdentifier = firstBracket;
        
        // Look for the next bracketed section which should be the actual source
        const sourceMatch = remainingLine.match(/^\[([^\]]+)\] /);
        if (sourceMatch) {
          source = sourceMatch[1]; // This should be "BROWSER"
          message = remainingLine.substring(sourceMatch[0].length);
          
          // Extract user agent from INFO entries if present
          if (message.includes('User-Agent:')) {
            const uaMatch = message.match(/User-Agent: ([^,\n]+)/);
            if (uaMatch) {
              userAgent = uaMatch[1];
            }
          }
        }
      }
      
      const screenshot = message.match(/\[SCREENSHOT\] (.+)/)?.[1];
      
      // Clean up CSS formatting directives in console log messages
      const cleanedMessage = cleanConsoleFormatting(message);
      
      currentEntry = {
        timestamp,
        source,
        message: cleanedMessage,
        screenshot,
        original: line,
        tabIdentifier,
        userAgent
      };
    } else if (currentEntry) {
      // Append to current entry's message
      currentEntry.message += '\n' + line;
      currentEntry.original += '\n' + line;
    }
  }
  
  // Don't forget the last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }
  
  return entries;
}
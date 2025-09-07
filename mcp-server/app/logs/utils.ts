import { LogEntry } from '@/types';

export function parseLogEntries(logContent: string): LogEntry[] {
  // Split by timestamp pattern - each timestamp starts a new log entry
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
      
      // Start new entry
      const [fullMatch, timestamp, source] = match;
      const message = line.substring(fullMatch.length);
      const screenshot = message.match(/\[SCREENSHOT\] (.+)/)?.[1];
      
      currentEntry = {
        timestamp,
        source,
        message,
        screenshot,
        original: line
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
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { LogEntry, LogsApiResponse, ConfigApiResponse, LogFile, LogListResponse } from '@/types';

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

// Keep this for backwards compatibility, but it's not used anymore
function parseLogLine(line: string): LogEntry | null {
  const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.*)$/s);
  if (!match) return null;
  
  const [, timestamp, source, message] = match;
  const screenshot = message.match(/\[SCREENSHOT\] (.+)/)?.[1];
  
  return {
    timestamp,
    source,
    message,
    screenshot,
    original: line
  };
}

function LogEntryComponent({ entry }: { entry: LogEntry }) {
  return (
    <div className="border-l-4 border-gray-200 pl-4 py-2">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="font-mono">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          entry.source === 'SERVER' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
        }`}>
          {entry.source}
        </span>
      </div>
      <div className="mt-1 font-mono text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">
        {entry.message}
      </div>
      {entry.screenshot && (
        <div className="mt-2">
          <img 
            src={entry.screenshot} 
            alt="Screenshot" 
            className="max-w-full h-auto border rounded shadow-sm"
            style={{ maxHeight: '400px' }}
          />
        </div>
      )}
    </div>
  );
}

interface LogsClientProps {
  version: string;
}

export default function LogsClient({ version }: LogsClientProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mode, setMode] = useState<'head' | 'tail'>('tail');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingNew, setIsLoadingNew] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [lastLogCount, setLastLogCount] = useState(0);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [availableLogs, setAvailableLogs] = useState<LogFile[]>([]);
  const [currentLogFile, setCurrentLogFile] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [showLogSelector, setShowLogSelector] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadAvailableLogs = async () => {
    try {
      const response = await fetch('/api/logs/list');
      if (response.ok) {
        const data: LogListResponse = await response.json();
        setAvailableLogs(data.files);
        setCurrentLogFile(data.currentFile);
        setProjectName(data.projectName);
      }
    } catch (error) {
      console.error('Error loading available logs:', error);
    }
  };

  const pollForNewLogs = async () => {
    if (mode !== 'tail' || !isAtBottom) return;
    
    try {
      const response = await fetch('/api/logs/tail?lines=1000');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: LogsApiResponse = await response.json();
      
      if (!data.logs) {
        console.warn('No logs data in response');
        return;
      }
      
      const entries = parseLogEntries(data.logs);
      
      if (entries.length > lastLogCount) {
        setIsLoadingNew(true);
        setLastFetched(new Date());
        setTimeout(() => {
          setLogs(entries);
          setLastLogCount(entries.length);
          setIsLoadingNew(false);
          // Auto-scroll to bottom for new content
          setTimeout(() => {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 50);
        }, 250);
      }
    } catch (error) {
      console.error('Error polling logs:', error);
      // Don't spam console on network errors during polling
    }
  };

  // Start/stop polling based on mode and scroll position
  useEffect(() => {
    if (mode === 'tail' && isAtBottom) {
      pollIntervalRef.current = setInterval(pollForNewLogs, 2000); // Poll every 2 seconds
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    }
  }, [mode, isAtBottom, lastLogCount]);

  const loadInitialLogs = async () => {
    setIsInitialLoading(true);
    
    // Load available logs list first
    await loadAvailableLogs();
    
    try {
      const response = await fetch(`/api/logs/${mode}?lines=1000`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: LogsApiResponse = await response.json();
      
      if (!data.logs) {
        console.warn('No logs data in response');
        setLogs([]);
        setIsInitialLoading(false);
        return;
      }
      
      const entries = parseLogEntries(data.logs);
      
      setLogs(entries);
      setLastLogCount(entries.length);
      setLastFetched(new Date());
      setIsInitialLoading(false);
      
      // Auto-scroll to bottom for tail mode
      if (mode === 'tail') {
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'auto' });
          setIsAtBottom(true);
        }, 100);
      }
    } catch (error) {
      console.error('Error loading logs:', error);
      setLogs([]);
    }
  };

  useEffect(() => {
    loadInitialLogs();
  }, [mode]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLogSelector(false);
      }
    };

    if (showLogSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showLogSelector]);

  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10;
      setIsAtBottom(atBottom);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs;
  }, [logs]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-4">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 whitespace-nowrap">dev3000</h1>
              <span className="text-xs text-gray-400 whitespace-nowrap">(v{version})</span>
              
              {/* Log File Selector */}
              {availableLogs.length > 1 ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setShowLogSelector(!showLogSelector)}
                    className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
                  >
                    <span className="font-mono text-xs">
                      {currentLogFile ? currentLogFile.split('/').pop() : 'dev3000.log'}
                    </span>
                    <svg 
                      className={`w-4 h-4 transition-transform ${showLogSelector ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                
                {/* Dropdown */}
                {showLogSelector && availableLogs.length > 1 && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 min-w-80">
                    <div className="py-1 max-h-60 overflow-y-auto">
                      <div className="px-3 py-2 text-xs font-medium text-gray-500 border-b">
                        {projectName} logs ({availableLogs.length})
                      </div>
                      {availableLogs.map((logFile) => (
                        <button
                          key={logFile.path}
                          onClick={() => {
                            // TODO: Implement log switching
                            setShowLogSelector(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between ${
                            logFile.isCurrent ? 'bg-blue-50 text-blue-900' : 'text-gray-700'
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-mono text-xs">
                              {logFile.name}
                            </span>
                            <span className="text-xs text-gray-500">
                              {new Date(logFile.mtime).toLocaleString()} • {Math.round(logFile.size / 1024)}KB
                            </span>
                          </div>
                          {logFile.isCurrent && (
                            <span className="text-xs text-blue-600 font-medium">current</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              ) : (
                <span className="font-mono text-xs text-gray-600 px-3 py-1">
                  {currentLogFile ? currentLogFile.split('/').pop() : 'dev3000.log'}
                </span>
              )}
              
              <span className="text-sm text-gray-500 hidden sm:inline">{logs.length} entries</span>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4 text-sm">
              {/* Mode Toggle */}
              <div className="flex items-center bg-gray-100 rounded-md p-1">
                <button
                  onClick={() => {
                    setMode('head');
                    // Scroll to top when switching to head mode
                    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={`px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    mode === 'head' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Head
                </button>
                <button
                  onClick={() => setMode('tail')}
                  className={`px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    mode === 'tail' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Tail
                </button>
              </div>
              
              {/* Live indicator */}
              <div 
                className={`flex items-center gap-1 text-green-600 ${
                  mode === 'tail' && isAtBottom ? 'visible' : 'invisible'
                }`}
              >
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs">Live</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="max-w-7xl mx-auto px-4 py-6 pb-14 max-h-screen overflow-y-auto"
        onScroll={handleScroll}
      >
        {isInitialLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <div className="text-gray-500 text-sm mt-4">Loading logs...</div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg">📝 No logs yet</div>
            <div className="text-gray-500 text-sm mt-2">
              Logs will appear here as your development server runs
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((entry, index) => (
              <LogEntryComponent key={index} entry={entry} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      
      {/* Footer with status and scroll indicator - full width like header */}
      <div className="py-2 border-t border-gray-200 bg-gray-50 fixed bottom-0 left-0 right-0">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center">
            {isLoadingNew && (
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 border border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
                <span className="text-xs text-gray-500">Loading...</span>
              </div>
            )}
            {!isLoadingNew && isAtBottom && lastFetched && (
              <span className="text-xs text-gray-400 font-mono">
                Last updated {lastFetched.toLocaleTimeString()}
              </span>
            )}
          </div>
          
          {/* Scroll to bottom button - positioned on the right */}
          {mode === 'tail' && !isAtBottom && !isLoadingNew && (
            <button
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              ↓ Live updates
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
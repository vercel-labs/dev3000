'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { LogEntry, LogsApiResponse, ConfigApiResponse } from '../../types';

function parseLogLine(line: string): LogEntry | null {
  const match = line.match(/\[([^\]]+)\] \[([^\]]+)\] (.+)/);
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
      <div className="mt-1 font-mono text-sm whitespace-pre-wrap">
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
  const [lastLogCount, setLastLogCount] = useState(0);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
      
      const entries = data.logs
        .split('\n')
        .filter((line: string) => line.trim())
        .map(parseLogLine)
        .filter((entry: LogEntry | null): entry is LogEntry => entry !== null);
      
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
    try {
      const response = await fetch(`/api/logs/${mode}?lines=1000`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: LogsApiResponse = await response.json();
      
      if (!data.logs) {
        console.warn('No logs data in response');
        setLogs([]);
        return;
      }
      
      const entries = data.logs
        .split('\n')
        .filter((line: string) => line.trim())
        .map(parseLogLine)
        .filter((entry: LogEntry | null): entry is LogEntry => entry !== null);
      
      setLogs(entries);
      setLastLogCount(entries.length);
      setLastFetched(new Date());
      
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
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">🎭 dev-playwright</h1>
              <span className="text-xs text-gray-400 ml-2">(v{version})</span>
              <span className="text-sm text-gray-500">{logs.length} entries</span>
            </div>
            
            <div className="flex items-center gap-4 text-sm">
              {/* Mode Toggle */}
              <div className="flex items-center bg-gray-100 rounded-md p-1">
                <button
                  onClick={() => setMode('head')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    mode === 'head' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  📄 Head
                </button>
                <button
                  onClick={() => setMode('tail')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    mode === 'tail' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  📺 Tail
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
        className="max-w-7xl mx-auto px-4 py-6 pb-10 max-h-screen overflow-y-auto"
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
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
      <div className="h-4 border-t border-gray-200 bg-gray-50 fixed bottom-0 left-0 right-0">
        <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
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
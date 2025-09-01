'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
  screenshot?: string;
  original: string;
}

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
    <div className="border-b border-gray-200 py-2 px-4">
      <div className="flex gap-4 text-sm">
        <span className="text-gray-500 font-mono whitespace-nowrap">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
        <span className={`font-medium uppercase text-xs px-2 py-1 rounded ${
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
            className="max-w-full border rounded shadow-sm"
            style={{ maxHeight: '300px' }}
          />
        </div>
      )}
    </div>
  );
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mode, setMode] = useState<'tail' | 'head'>('tail');
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Virtual scrolling state
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const itemHeight = 100; // Estimated height per log entry

  const visibleLogs = useMemo(() => {
    return logs.slice(visibleRange.start, visibleRange.end);
  }, [logs, visibleRange]);

  useEffect(() => {
    loadInitialLogs();
  }, [mode]);

  useEffect(() => {
    if (mode === 'tail' && isStreaming) {
      startStreaming();
    }
  }, [mode, isStreaming]);

  useEffect(() => {
    if (mode === 'tail' && logs.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, mode]);

  const loadInitialLogs = async () => {
    try {
      const response = await fetch(`/api/logs/${mode}?lines=100`);
      const data = await response.json();
      
      if (data.lines) {
        const entries = data.lines
          .map(parseLogLine)
          .filter((entry): entry is LogEntry => entry !== null);
        setLogs(entries);
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  };

  const startStreaming = () => {
    const eventSource = new EventSource('/api/logs/stream');
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.newLines) {
        const newEntries = data.newLines
          .map(parseLogLine)
          .filter((entry): entry is LogEntry => entry !== null);
        
        setLogs(prev => [...prev, ...newEntries]);
      }
    };

    eventSource.onerror = (error) => {
      console.error('Streaming error:', error);
      setIsStreaming(false);
    };

    return () => eventSource.close();
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    
    const start = Math.floor(scrollTop / itemHeight);
    const end = Math.min(start + Math.ceil(containerHeight / itemHeight) + 5, logs.length);
    
    setVisibleRange({ start, end });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Development Logs</h1>
          
          <div className="mt-4 flex gap-4 items-center">
            <div className="flex gap-2">
              <button
                onClick={() => setMode('tail')}
                className={`px-4 py-2 rounded text-sm font-medium ${
                  mode === 'tail' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Tail (Recent)
              </button>
              <button
                onClick={() => setMode('head')}
                className={`px-4 py-2 rounded text-sm font-medium ${
                  mode === 'head' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Head (Start)
              </button>
            </div>
            
            {mode === 'tail' && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isStreaming}
                  onChange={(e) => setIsStreaming(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-gray-600">Live updates</span>
              </label>
            )}
            
            <button
              onClick={loadInitialLogs}
              className="px-4 py-2 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
            >
              Refresh
            </button>
          </div>
          
          <div className="mt-2 text-sm text-gray-600">
            Showing {logs.length} log entries
          </div>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="max-w-7xl mx-auto"
        style={{ height: 'calc(100vh - 140px)', overflow: 'auto' }}
        onScroll={handleScroll}
      >
        {/* Virtual scrolling spacer */}
        <div style={{ height: visibleRange.start * itemHeight }} />
        
        {visibleLogs.map((entry, index) => (
          <LogEntryComponent 
            key={visibleRange.start + index} 
            entry={entry} 
          />
        ))}
        
        {/* Virtual scrolling spacer */}
        <div style={{ height: (logs.length - visibleRange.end) * itemHeight }} />
        
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
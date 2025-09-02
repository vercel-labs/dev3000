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
  const [userScrolled, setUserScrolled] = useState(false);
  const [logFilePath, setLogFilePath] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadInitialLogs();
    loadConfig();
  }, [mode]);

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      setLogFilePath(data.logFilePath);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  useEffect(() => {
    if (mode === 'tail' && isStreaming) {
      startStreaming();
    }
  }, [mode, isStreaming]);

  useEffect(() => {
    if (mode === 'tail' && logs.length > 0 && !userScrolled) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, mode, userScrolled]);

  const loadInitialLogs = async () => {
    try {
      const response = await fetch(`/api/logs/${mode}?lines=1000`);
      const data = await response.json();
      
      if (data.lines) {
        const entries = data.lines
          .map(parseLogLine)
          .filter((entry: LogEntry | null): entry is LogEntry => entry !== null);
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
          .filter((entry: LogEntry | null): entry is LogEntry => entry !== null);
        
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
    const scrollHeight = container.scrollHeight;
    
    // Check if user scrolled away from bottom
    const isAtBottom = scrollTop + containerHeight >= scrollHeight - 10;
    setUserScrolled(!isAtBottom);
  };

  const scrollToBottom = () => {
    setUserScrolled(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">🎭 Dev Playwright</h1>
              <span className="text-sm text-gray-500">{logs.length} entries</span>
            </div>
            
            <div className="flex items-center gap-4 text-sm">
              <button
                onClick={() => setMode('tail')}
                className={`${mode === 'tail' ? 'text-blue-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Tail
              </button>
              <button
                onClick={() => setMode('head')}
                className={`${mode === 'head' ? 'text-blue-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Head
              </button>
              
              {mode === 'tail' && (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={isStreaming}
                    onChange={(e) => setIsStreaming(e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span className="text-gray-600">Live</span>
                </label>
              )}
              
              <button
                onClick={loadInitialLogs}
                className="text-gray-600 hover:text-gray-900"
              >
                Refresh
              </button>
              
              <a 
                href="https://github.com/elsigh/dev-playwright"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-gray-900 transition-colors"
                title="View on GitHub"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
                </svg>
              </a>
            </div>
          </div>
          
          {logFilePath && (
            <div className="mt-2 text-xs text-gray-500">
              📄 <code className="bg-gray-100 px-1 rounded">{logFilePath}</code>
            </div>
          )}
        </div>
      </div>

      <div 
        ref={containerRef}
        className="w-full px-4"
        style={{ height: 'calc(100vh - 80px)', overflow: 'auto' }}
        onScroll={handleScroll}
      >
        {logs.map((entry, index) => (
          <LogEntryComponent 
            key={index} 
            entry={entry} 
          />
        ))}
        
        <div ref={bottomRef} />
      </div>
      
      {userScrolled && mode === 'tail' && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-6 right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 transition-all"
          title="Scroll to bottom and resume auto-scroll"
        >
          ↓
        </button>
      )}
    </div>
  );
}
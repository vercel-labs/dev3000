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
  // Parse log type from message patterns
  const parseLogType = (message: string) => {
    if (message.includes('[INTERACTION]')) return { type: 'INTERACTION', color: 'bg-purple-50 border-purple-200', tag: 'bg-purple-100 text-purple-800' };
    if (message.includes('[CONSOLE ERROR]')) return { type: 'ERROR', color: 'bg-red-50 border-red-200', tag: 'bg-red-100 text-red-800' };
    if (message.includes('[CONSOLE WARN]')) return { type: 'WARNING', color: 'bg-yellow-50 border-yellow-200', tag: 'bg-yellow-100 text-yellow-800' };
    if (message.includes('[SCREENSHOT]')) return { type: 'SCREENSHOT', color: 'bg-blue-50 border-blue-200', tag: 'bg-blue-100 text-blue-800' };
    if (message.includes('[NAVIGATION]')) return { type: 'NAVIGATION', color: 'bg-indigo-50 border-indigo-200', tag: 'bg-indigo-100 text-indigo-800' };
    if (message.includes('[NETWORK ERROR]')) return { type: 'NETWORK', color: 'bg-red-50 border-red-200', tag: 'bg-red-100 text-red-800' };
    if (message.includes('[NETWORK REQUEST]')) return { type: 'NETWORK', color: 'bg-gray-50 border-gray-200', tag: 'bg-gray-100 text-gray-700' };
    if (message.includes('[PAGE ERROR]')) return { type: 'ERROR', color: 'bg-red-50 border-red-200', tag: 'bg-red-100 text-red-800' };
    return { type: 'DEFAULT', color: 'border-gray-200', tag: 'bg-gray-100 text-gray-700' };
  };

  const logTypeInfo = parseLogType(entry.message);
  
  // Extract and highlight type tags
  const renderMessage = (message: string) => {
    const typeTagRegex = /\[([A-Z\s]+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    
    while ((match = typeTagRegex.exec(message)) !== null) {
      // Add text before the tag
      if (match.index > lastIndex) {
        parts.push(message.slice(lastIndex, match.index));
      }
      
      // Add the tag with styling
      parts.push(
        <span 
          key={match.index}
          className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${logTypeInfo.tag} mr-1`}
        >
          {match[1]}
        </span>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < message.length) {
      parts.push(message.slice(lastIndex));
    }
    
    return parts.length > 0 ? parts : message;
  };

  return (
    <div className={`border-l-4 ${logTypeInfo.color} pl-4 py-2`}>
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
        {renderMessage(entry.message)}
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
  const [isReplaying, setIsReplaying] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showReplayPreview, setShowReplayPreview] = useState(false);
  const [replayEvents, setReplayEvents] = useState<any[]>([]);
  const [isRotatingLog, setIsRotatingLog] = useState(false);
  const [filters, setFilters] = useState({
    browser: true,
    server: true,
    interaction: true,
    screenshot: true
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLogSelector(false);
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
    };

    if (showLogSelector || showFilters) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showLogSelector, showFilters]);

  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10;
      setIsAtBottom(atBottom);
    }
  };

  const handleReplay = async () => {
    if (isReplaying) return;
    
    setIsReplaying(true);
    
    try {
      // Get replay data from logs
      const response = await fetch('/api/replay?action=parse');
      if (!response.ok) {
        throw new Error('Failed to parse replay data');
      }
      
      const replayData = await response.json();
      
      if (replayData.interactions.length === 0) {
        alert('No user interactions found in logs to replay');
        return;
      }
      
      // Generate CDP commands for replay
      const response2 = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          replayData: replayData,
          speed: 2
        })
      });
      
      const result = await response2.json();
      
      if (result.success) {
        console.log('Replay executed successfully:', result);
        alert(`Replay completed! Executed ${result.totalCommands} commands.`);
      } else {
        console.log('CDP execution failed, showing commands:', result);
        alert(`CDP execution not available. Generated ${result.commands?.length || 0} commands. Check console for details.`);
      }
      
    } catch (error) {
      console.error('Replay error:', error);
      alert('Failed to start replay: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsReplaying(false);
    }
  };

  const loadReplayPreview = async () => {
    try {
      const response = await fetch('/api/replay?action=parse');
      if (response.ok) {
        const data = await response.json();
        setReplayEvents(data.interactions || []);
      }
    } catch (error) {
      console.error('Error loading replay preview:', error);
    }
  };

  const handleRotateLog = async () => {
    if (!currentLogFile || isRotatingLog) return;
    
    setIsRotatingLog(true);
    try {
      const response = await fetch('/api/logs/rotate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentLogPath: currentLogFile }),
      });

      if (response.ok) {
        // Clear current logs from UI
        setLogs([]);
        setLastLogCount(0);
        setLastFetched(null);
        
        // Reload available logs to show the new archived file
        await loadAvailableLogs();
        
        // Start fresh polling
        await loadInitialLogs();
      } else {
        const error = await response.json();
        console.error('Failed to rotate log:', error);
        alert('Failed to rotate log: ' + error.error);
      }
    } catch (error) {
      console.error('Error rotating log:', error);
      alert('Error rotating log');
    } finally {
      setIsRotatingLog(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(entry => {
      // Check specific message types first (these override source filtering)
      const isInteraction = entry.message.includes('[INTERACTION]');
      const isScreenshot = entry.message.includes('[SCREENSHOT]');
      
      if (isInteraction) return filters.interaction;
      if (isScreenshot) return filters.screenshot;
      
      // For other logs, filter by source
      if (entry.source === 'SERVER') return filters.server;
      if (entry.source === 'BROWSER') return filters.browser;
      
      return true;
    });
  }, [logs, filters]);

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header - Fixed */}
      <div className="bg-white shadow-sm border-b flex-none z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-1">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 whitespace-nowrap">dev3000</h1>
                <span className="text-xs text-gray-400 whitespace-nowrap">(v{version})</span>
              </div>
              
              {/* Log File Selector */}
              {availableLogs.length > 1 ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setShowLogSelector(!showLogSelector)}
                    className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
                  >
                    <span className="font-mono text-xs whitespace-nowrap">
                      {isInitialLoading && !currentLogFile ? (
                        <div className="h-4 bg-gray-200 rounded animate-pulse" style={{width: '220px'}} />
                      ) : (
                        currentLogFile ? currentLogFile.split('/').pop() : 'dev3000.log'
                      )}
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
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-600 px-3 py-1 whitespace-nowrap">
                    {isInitialLoading && !currentLogFile ? (
                      <div className="h-4 bg-gray-200 rounded animate-pulse" style={{width: '220px'}} />
                    ) : (
                      currentLogFile ? currentLogFile.split('/').pop() : 'dev3000.log'
                    )}
                  </span>
                  {currentLogFile && !isInitialLoading && (
                    <button
                      onClick={handleRotateLog}
                      disabled={isRotatingLog}
                      className="px-2 py-1 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Clear logs (rotate current log to archive and start fresh)"
                    >
                      {isRotatingLog ? '...' : 'Clear'}
                    </button>
                  )}
                </div>
              )}
              
              {logs.length > 0 && (
                <span className="text-sm text-gray-500 hidden sm:inline">{logs.length} entries</span>
              )}
            </div>
            
            {/* Mode Toggle with Replay Button */}
            <div className="flex items-center gap-2">
              {/* Replay Button with Hover Preview */}
              <div className="relative">
                <button
                  onClick={handleReplay}
                  disabled={isReplaying}
                  onMouseEnter={() => {
                    if (!isReplaying) {
                      loadReplayPreview();
                      setShowReplayPreview(true);
                    }
                  }}
                  onMouseLeave={() => setShowReplayPreview(false)}
                  className={`flex items-center gap-1 px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap ${
                    isReplaying
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                  }`}
                >
                  {isReplaying ? (
                    <>
                      <div className="w-3 h-3 border border-purple-300 border-t-purple-600 rounded-full animate-spin"></div>
                      Replaying...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M7 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-9 4h16m-5 4v1a1 1 0 01-1 1H8a1 1 0 01-1-1v-1m8 0V9a1 1 0 00-1-1H8a1 1 0 00-1 1v8.001" />
                      </svg>
                      Replay
                    </>
                  )}
                </button>
                
                {/* Replay Preview Dropdown */}
                {showReplayPreview && !isReplaying && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-30 w-80">
                    <div className="py-2">
                      <div className="px-3 py-2 text-xs font-medium text-gray-500 border-b">
                        Replay Events ({replayEvents.length})
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {replayEvents.length === 0 ? (
                          <div className="px-3 py-4 text-sm text-gray-500 text-center">
                            No interactions to replay
                          </div>
                        ) : (
                          replayEvents.map((event, index) => (
                            <div key={index} className="px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  event.type === 'CLICK' ? 'bg-blue-100 text-blue-800' :
                                  event.type === 'SCROLL' ? 'bg-green-100 text-green-800' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {event.type}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">
                                  {new Date(event.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-600 font-mono truncate">
                                {event.type === 'CLICK' && `(${event.x}, ${event.y}) on ${event.target}`}
                                {event.type === 'SCROLL' && `${event.direction} ${event.distance}px to (${event.x}, ${event.y})`}
                                {event.type === 'KEY' && `${event.key} in ${event.target}`}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Filter Button */}
              <div className="relative" ref={filterDropdownRef}>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1 px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Filter
                </button>
                
                {/* Filter Dropdown */}
                {showFilters && (
                  <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 min-w-48">
                    <div className="py-2">
                      <div className="px-3 py-2 text-xs font-medium text-gray-500 border-b">
                        Log Types
                      </div>
                      {[
                        { key: 'server', label: 'Server', count: logs.filter(l => l.source === 'SERVER').length },
                        { key: 'browser', label: 'Browser', count: logs.filter(l => l.source === 'BROWSER').length },
                        { key: 'interaction', label: 'Interaction', count: logs.filter(l => l.message.includes('[INTERACTION]')).length },
                        { key: 'screenshot', label: 'Screenshot', count: logs.filter(l => l.message.includes('[SCREENSHOT]')).length }
                      ].map(({ key, label, count }) => (
                        <label
                          key={key}
                          className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={filters[key as keyof typeof filters]}
                              onChange={(e) => setFilters(prev => ({ ...prev, [key]: e.target.checked }))}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>{label}</span>
                          </div>
                          <span className="text-xs text-gray-400">{count}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
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
            </div>
          </div>
        </div>
      </div>

      {/* Content Area - Fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <div 
          ref={containerRef}
          className="max-w-7xl mx-auto px-4 py-6 h-full overflow-y-auto"
          onScroll={handleScroll}
        >
          {isInitialLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <div className="text-gray-500 text-sm mt-4">Loading logs...</div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg">📝 No logs yet</div>
              <div className="text-gray-500 text-sm mt-2">
                Logs will appear here as your development server runs
              </div>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg">🔍 No logs match current filters</div>
              <div className="text-gray-500 text-sm mt-2">
                Try adjusting your filter settings to see more logs
              </div>
            </div>
          ) : (
            <div className="space-y-1 pb-4">
              {filteredLogs.map((entry, index) => (
                <LogEntryComponent key={index} entry={entry} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
      
      {/* Footer - Fixed */}
      <div className="border-t border-gray-200 bg-gray-50 flex-none">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isLoadingNew && (
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 border border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
                <span className="text-xs text-gray-500">Loading...</span>
              </div>
            )}
            {!isLoadingNew && lastFetched && (
              <span className="text-xs text-gray-400 font-mono">
                Last updated {lastFetched.toLocaleTimeString()}
              </span>
            )}
            {currentLogFile && (
              <a 
                href={`file://${currentLogFile}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                Raw Log ↗
              </a>
            )}
          </div>
          
          {/* Live indicator or scroll to bottom button - positioned on the right */}
          <div className="relative">
            {/* Live indicator when at bottom */}
            <div 
              className={`flex items-center gap-1 text-green-600 ${
                mode === 'tail' && isAtBottom && !isLoadingNew ? 'visible' : 'invisible'
              }`}
            >
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs">Live</span>
            </div>
            
            {/* Scroll to bottom button when not at bottom */}
            <button
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className={`absolute top-0 right-0 flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 whitespace-nowrap ${
                mode === 'tail' && !isAtBottom && !isLoadingNew ? 'visible' : 'invisible'
              }`}
            >
              ↓ Live
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
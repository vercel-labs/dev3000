# Error Monitoring with Claude

## Overview

dev3000 now provides a clever solution for proactive error monitoring with Claude. When users say "monitor my app", Claude receives executable Python code that continuously watches for errors and prompts for fixes.

## How It Works

### The `start_error_monitoring` Tool

This MCP tool returns a Python script that:
1. Monitors the dev3000 log file for critical errors
2. Tracks which errors have already been seen
3. Alerts when new errors appear
4. Prompts the user to let Claude investigate and fix

### Usage Flow

1. **User**: "Monitor my app for errors"
2. **Claude**: Calls `start_error_monitoring` tool
3. **Tool**: Returns Python monitoring script
4. **Claude**: Executes the Python script
5. **Script**: Continuously monitors logs
6. **On Error**: Displays alert and prompts user
7. **User**: "Fix my app" or "Debug my app"
8. **Claude**: Uses fix_my_app tool to analyze and fix

### What Errors Are Detected

The monitoring script watches for:
- Runtime errors (`[RUNTIME.ERROR]`)
- Browser crashes (`[CHROME.CRASH]`)
- Fatal errors
- JavaScript errors (TypeError, ReferenceError, SyntaxError)
- Module not found errors
- Unhandled promise rejections
- Out of memory errors

### Example Output

```
🔍 Starting dev3000 error monitoring...
📁 Watching: /Users/name/.d3k/logs/dev3000-myapp-2025-01-22.log
⏱️  Check interval: 5 seconds
🛑 Press Ctrl+C to stop monitoring
------------------------------------------------------------

============================================================
🚨 2 NEW CRITICAL ERRORS DETECTED!
⏰ Time: 14:23:45
📊 Total errors this session: 2
============================================================

Error 1 - Type Error:
  [2025-01-22T14:23:45.123Z] [BROWSER] [RUNTIME.ERROR] TypeError: Cannot read property 'map' of undefined

Error 2 - Reference Error:
  [2025-01-22T14:23:45.456Z] [SERVER] ReferenceError: myVariable is not defined

🔧 ========================================================
💡 To fix these errors, tell me: 'fix my app' or 'debug my app'
   I'll analyze the full context and fix the issues!
============================================================
```

## Benefits

1. **Proactive Detection**: Errors are caught as they happen
2. **User Control**: User decides when to let Claude investigate
3. **Low Overhead**: Lightweight Python script with minimal resource usage
4. **Smart Deduplication**: Same errors aren't reported multiple times
5. **Works Within Claude's Constraints**: Uses Claude's ability to execute code

## Technical Implementation

The tool:
- Generates a Python script with the actual log file path embedded
- Uses file seeking to efficiently read only new log lines
- Maintains a set of seen error hashes to prevent duplicates
- Provides clear, actionable prompts when errors are found

## Future Enhancements

Potential improvements could include:
- Configurable error patterns
- Different alert levels (critical vs warning)
- Integration with system notifications
- Automatic error categorization
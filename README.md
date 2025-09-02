# dev-playwright

Captures your web app's complete development timeline - server logs, browser events, console messages, network requests, and automatic screenshots - in a unified, timestamped feed for AI debugging.

## Quick Start

```bash
pnpm install dev-playwright
pnpx dev-playwright
```

## What it does

Creates a comprehensive log of your development session that AI assistants can easily understand. When you have a bug or issue, Claude can see your server output, browser console, network requests, and screenshots all in chronological order.

The tool monitors your app in a real browser and captures:
- Server logs and console output
- Browser console messages and errors  
- Network requests and responses
- Automatic screenshots on navigation, errors, and key events
- Visual timeline at `http://localhost:3684/logs`

## AI Integration

Give Claude your log file for instant debugging:

```
Read /tmp/dev-playwright-consolidated.log
```

Or use the MCP server at `http://localhost:3684/api/mcp/http` for advanced querying:
- `read_consolidated_logs` - Get recent logs with filtering
- `search_logs` - Regex search with context  
- `get_browser_errors` - Extract browser errors by time period

## Options

```bash
pnpx dev-playwright [options]

  -p, --port <port>         Your app's port (default: 3000)
  --mcp-port <port>         MCP server port (default: 3684)  
  -s, --script <script>     Package.json script to run (default: dev)
  --profile-dir <dir>       Chrome profile directory (persists cookies/login state)
  --log-file <file>         Log file path
```

Examples:
```bash
# Custom port for Vite  
pnpx dev-playwright --port 5173

# Persistent login state
pnpx dev-playwright --profile-dir ./chrome-profile
```

---

_Made by [elsigh](https://github.com/elsigh)_

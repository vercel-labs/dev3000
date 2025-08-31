# AI Dev

AI-powered development tools with browser monitoring, intelligent logging, and Model Context Protocol (MCP) server integration. Designed to work seamlessly with AI assistants like Claude for any web development project.

## Features

🤖 **AI Assistant Integration** - Built-in MCP server for Claude and other AI tools  
🔍 **Smart Browser Monitoring** - Automatic capture of console logs, network requests, and errors  
📊 **Unified Logging** - Interleaved server and browser logs with timestamps  
⚡ **One Command Setup** - Automatic installation of MCP routes in your Next.js app  
🧹 **Clean Profiles** - Isolated browser profiles for development  

## Quick Start

### Install and Setup

```bash
# Install the package globally
npm install -g aidev

# Or use directly with npx
npx aidev start
```

### Start Development

```bash
# Start AI-enhanced development environment
aidev start
```

This will:
- Start your Next.js dev server
- Launch browser with monitoring
- Create unified logs at `./ai-dev-tools/consolidated.log`  
- Serve MCP tools at `http://localhost:3684/api/mcp/http`

## MCP Tools for AI Assistants

Once running, AI assistants can use these tools:

- **`read_consolidated_logs`** - Read recent development logs with optional filtering
- **`search_logs`** - Regex search through logs with context lines
- **`get_browser_errors`** - Extract browser errors from specified time periods

Access these tools at: `http://localhost:3684/api/mcp/http`

## Requirements

- **Node.js 18+**
- **Chrome/Chromium** browser (auto-installed via Playwright)

## How It Works

1. **Development**: Launches your dev server + browser monitoring + MCP server
2. **AI Integration**: Provides standalone MCP server for intelligent log analysis
3. **No Setup**: Works with any web development project

## File Structure Created

```
your-project/
├── ai-dev-tools/
│   ├── chrome-profile/               # Isolated browser profile
│   └── consolidated.log              # Unified development logs
└── (MCP server runs separately on port 3001)
```

## Commands

```bash
# Start development environment  
aidev start [options]
# or
npx aidev start [options]

# Options:
#   -p, --port <port>              Dev server port (default: 3000)
#   --mcp-port <port>              MCP server port (default: 3684)
#   --server-command <command>     Custom server command (default: pnpm dev)
#   --profile-dir <dir>            Chrome profile directory
#   --log-file <file>              Log file path
```

## Log Format

```
[2025-08-30T12:54:03.033Z] [SERVER] Ready on http://localhost:3000
[2025-08-30T12:54:03.435Z] [BROWSER] [CONSOLE LOG] App initialized  
[2025-08-30T12:54:03.602Z] [BROWSER] [NETWORK REQUEST] GET http://localhost:3000/api/data
[2025-08-30T12:54:03.820Z] [BROWSER] [NAVIGATION] http://localhost:3000/dashboard
```

## License

MIT
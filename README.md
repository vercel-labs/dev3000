# Next.js AI Development Tools

AI-powered development tools for Next.js with browser monitoring, intelligent logging, and Model Context Protocol (MCP) server integration. Designed to work seamlessly with AI assistants like Claude.

## Features

🤖 **AI Assistant Integration** - Built-in MCP server for Claude and other AI tools  
🔍 **Smart Browser Monitoring** - Automatic capture of console logs, network requests, and errors  
📊 **Unified Logging** - Interleaved server and browser logs with timestamps  
⚡ **One Command Setup** - Automatic installation of MCP routes in your Next.js app  
🧹 **Clean Profiles** - Isolated browser profiles for development  

## Quick Start

### Install and Setup

```bash
# Install the package
npm install next-ai-dev

# Setup MCP routes in your Next.js app (run from your Next.js project root)
npx next-ai-dev setup

# Install the dependencies that were added
npm install
```

### Start Development

```bash
# Start AI-enhanced development environment
npm run dev:ai
```

This will:
- Start your Next.js dev server
- Launch browser with monitoring
- Create unified logs at `./ai-dev-tools/consolidated.log`  
- Serve MCP tools at `http://localhost:3000/api/mcp/http`

## MCP Tools for AI Assistants

Once running, AI assistants can use these tools:

- **`read_consolidated_logs`** - Read recent development logs with optional filtering
- **`search_logs`** - Regex search through logs with context lines
- **`get_browser_errors`** - Extract browser errors from specified time periods

## Requirements

- **Next.js 13+** with app directory
- **Node.js 18+**
- **Chrome/Chromium** browser

## How It Works

1. **Setup Phase**: Adds MCP API routes to your Next.js app
2. **Development**: Launches coordinated dev server + browser monitoring  
3. **AI Integration**: Provides MCP endpoint for intelligent log analysis

## File Structure Created

```
your-nextjs-app/
├── app/api/mcp/[transport]/route.ts  # MCP server endpoint
├── ai-dev-tools/
│   ├── chrome-profile/               # Isolated browser profile
│   └── consolidated.log              # Unified development logs
└── package.json                      # Updated with dev:ai script
```

## Commands

```bash
# Setup MCP routes and scripts
npx next-ai-dev setup [--force]

# Start development environment  
npx next-ai-dev start [options]

# Options:
#   -p, --port <port>              Dev server port (default: 3000)
#   --server-command <command>     Custom server command (default: npm run dev)
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
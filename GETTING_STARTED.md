# Getting Started with dev3000

Complete guide for using dev3000 from zero to production-ready debugging.

## Table of Contents

- [What is dev3000?](#what-is-dev3000)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Local Installation](#local-installation)
  - [Docker Installation](#docker-installation)
- [Quick Start](#quick-start)
- [Understanding the Workflow](#understanding-the-workflow)
- [Common Use Cases](#common-use-cases)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Advanced Features](#advanced-features)

## What is dev3000?

dev3000 is a comprehensive development monitoring tool that captures everything happening in your web application:

- **Server logs** - All console output from your development server
- **Browser events** - Console messages, errors, warnings from the browser
- **Network activity** - HTTP requests, responses, and their timing
- **User interactions** - Clicks, scrolls, keyboard input
- **Automatic screenshots** - Visual snapshots on errors, navigation, and key events
- **AI-powered debugging** - Integration with Claude Code and other AI assistants

Think of it as a "black box recorder" for your development environment that helps AI understand exactly what's happening when bugs occur.

## Prerequisites

Before installing dev3000, ensure you have:

### Required

- **Node.js** version 18.x or higher
  - Check: `node --version`
  - Install: https://nodejs.org/

- **Package Manager** - One of:
  - pnpm (recommended): `npm install -g pnpm`
  - npm (built-in with Node.js)
  - yarn: `npm install -g yarn`
  - bun: `curl -fsSL https://bun.sh/install | bash`

- **Chrome or Chromium Browser**
  - Check: `google-chrome --version` (Linux) or open Chrome and check version
  - Install: https://www.google.com/chrome/

### Optional (for enhanced features)

- **Docker** (for Docker/WSL2 workflows)
  - Check: `docker --version`
  - Install: https://docs.docker.com/get-docker/

- **Make** (for using Makefile commands)
  - Usually pre-installed on macOS/Linux
  - Windows: Install via WSL2 or Git Bash

## Installation

### Local Installation

Install dev3000 globally to use it across all your projects:

```bash
# Using pnpm (recommended)
pnpm install -g github:automationjp/dev3000

# Using npm
npm install -g github:automationjp/dev3000

# Using yarn
yarn global add github:automationjp/dev3000

# Using bun
bun install -g github:automationjp/dev3000
```

Verify installation:

```bash
dev3000 --version
```

You should see the version number displayed.

### Docker Installation (Required for Windows)

**Windows users**: dev3000's Chrome automation doesn't work directly on Windows due to CDP limitations. Use Docker/WSL2 instead.

#### Setup for YOUR Next.js Project with Docker

**Prerequisites**:
- Docker Desktop installed on Windows
- WSL2 enabled
- Your Next.js project exists somewhere on your Windows filesystem

**Steps**:

1. **Clone this repository** (for Docker configuration):
   ```bash
   git clone https://github.com/automationjp/dev3000.git
   cd dev3000
   ```

2. **Configure Docker to use YOUR project**:

   Edit `docker/docker-compose.yml` and change the volume mount to point to YOUR Next.js project:

   ```yaml
   services:
     dev3000:
       volumes:
         # CHANGE THIS LINE to YOUR project path (WSL2 format):
         - /mnt/c/Users/YourName/Projects/my-nextjs-app:/app

         # KEEP these lines as-is (they optimize Docker performance):
         - /app/node_modules
         - /app/.next
   ```

   **Windows Path → WSL2 Path Conversion**:
   | Windows Path | WSL2 Path |
   |--------------|-----------|
   | `C:\Users\John\Projects\my-app` | `/mnt/c/Users/John/Projects/my-app` |
   | `D:\github\ecommerce` | `/mnt/d/github/ecommerce` |
   | `C:\dev\nextjs-blog` | `/mnt/c/dev/nextjs-blog` |

3. **Start dev3000**:
   ```bash
   make dev-up
   ```

   This automatically:
   - ✅ Launches Chrome with CDP on your Windows host
   - ✅ Starts dev3000 in Docker container monitoring YOUR project
   - ✅ Enables real-time log streaming via SSE
   - ✅ Installs dependencies inside container (doesn't touch your host)

4. **Access the interfaces**:
   - **Your App**: http://localhost:3000
   - **Dev3000 UI**: http://localhost:3684
   - **Logs Viewer**: http://localhost:3684/logs

5. **Stop dev3000**:
   ```bash
   make dev-down
   ```

6. **View logs**:
   ```bash
   make dev-logs
   ```

#### Understanding the Docker Setup

The Docker architecture solves Windows compatibility issues:

```
┌─────────────────────────────────────────┐
│        Windows Host                     │
│                                         │
│  ┌─────────────────┐                   │
│  │ Your Next.js    │◄──── Volume mount │
│  │ Project         │                   │
│  └─────────────────┘                   │
│                                         │
│  ┌─────────────────┐                   │
│  │ Chrome Browser  │                   │
│  │ (CDP enabled)   │◄──┐               │
│  └─────────────────┘   │               │
│                        │ CDP over      │
│                        │ host.docker   │
└────────────────────────┼───────────────┘
                         │ .internal
┌────────────────────────┼───────────────┐
│  Docker Container      │               │
│                        │               │
│  ┌─────────────────┐   │               │
│  │ dev3000         │───┘               │
│  │ + Node.js       │                   │
│  │ + MCP Server    │                   │
│  └─────────────────┘                   │
│                                         │
│  /app ───► Your project (mounted)      │
│  /app/node_modules ───► Container only │
│  /app/.next ───► Container only        │
└─────────────────────────────────────────┘
```

**Key Benefits**:
1. **Chrome on Windows** - Full GPU acceleration, proper window management
2. **dev3000 in Linux** - Proper file system permissions, Unix tools work correctly
3. **Volume Optimization** - `node_modules` and `.next` stay in container for speed
4. **No Host Pollution** - Dependencies installed in container don't touch your host machine

**What You Need to Configure**:
- ✅ `docker/docker-compose.yml` - Change ONE line (volume mount to YOUR project)
- ❌ **No configuration files needed in YOUR project**
- ❌ **No changes to YOUR project's package.json**
- ❌ **No dev3000 installation needed on Windows**

Everything is self-contained in the Docker setup!

## Quick Start

### For Your Own Next.js Project

dev3000 works with **any** Next.js project (or React/Vite/Vue project). No special configuration needed!

1. **Install dev3000 globally** (one-time setup):
   ```bash
   pnpm install -g github:automationjp/dev3000
   # or: npm install -g github:automationjp/dev3000
   # or: yarn global add github:automationjp/dev3000
   ```

2. **Navigate to YOUR project**:
   ```bash
   cd /path/to/your/nextjs-project
   # This can be ANY Next.js project - existing or new!
   ```

3. **Start dev3000**:
   ```bash
   dev3000
   ```

   That's it! dev3000 will automatically:
   - Detect your package manager (pnpm/npm/yarn/bun)
   - Run the correct dev command (`pnpm run dev`, `npm run dev`, etc.)
   - Launch Chrome with monitoring enabled
   - Start the MCP server for AI integration
   - Open your app in the browser

4. **Access the interfaces**:
   - **Your App**: http://localhost:3000
   - **Dev3000 UI**: http://localhost:3684
   - **Logs Viewer**: http://localhost:3684/logs (real-time log updates)

**Important**: dev3000 does NOT require any configuration files in your project. It works out-of-the-box with any standard Next.js, React, Vite, or Vue project.

#### Example: Using dev3000 with a brand new Next.js project

```bash
# 1. Create a new Next.js project
npx create-next-app@latest my-app

# 2. Go into your new project
cd my-app

# 3. Start dev3000 (instead of "npm run dev")
dev3000
```

That's all! No `.dev3000.json`, no configuration files needed.

#### Example: Using dev3000 with your existing Next.js project

```bash
# Go to your existing project
cd /path/to/your/existing/nextjs/app

# Just run dev3000
dev3000
```

dev3000 will use your existing `package.json` and run the appropriate dev command.

### For Other Frameworks (Vite, React, Vue, etc.)

1. **Navigate to your project**:
   ```bash
   cd my-vite-app
   ```

2. **Start dev3000 with the correct script**:
   ```bash
   # Vite projects typically use "dev" script
   dev3000 --script dev --port 5173

   # React (Create React App)
   dev3000 --script start --port 3000

   # Custom port
   dev3000 --port 8080
   ```

3. **Access the interfaces**:
   - **Your App**: http://localhost:[YOUR_PORT]
   - **Dev3000 UI**: http://localhost:3684
   - **Logs Viewer**: http://localhost:3684/logs

## Understanding the Workflow

Here's how dev3000 fits into your development workflow:

### 1. Normal Development

Start dev3000 instead of running `npm run dev` directly:

```bash
# Instead of: npm run dev
# Use: dev3000
dev3000
```

Work on your app normally - dev3000 runs silently in the background, capturing all activity.

### 2. When Issues Occur

When you encounter a bug or unexpected behavior:

1. **Check the Logs UI**: Go to http://localhost:3684/logs
   - View timeline of events leading to the issue
   - See browser errors, network failures, console warnings
   - Review automatic screenshots

2. **Ask AI for Help**:
   ```
   # In Claude Code
   "fix my app"
   ```

   dev3000's AI integration will:
   - Analyze consolidated logs
   - Identify error patterns
   - Suggest specific fixes
   - Provide code changes

### 3. After Fixing

Continue developing - dev3000 keeps running and monitoring for the next issue.

### 4. Stopping dev3000

When done:

```bash
# Press Ctrl+C
^C
```

This gracefully shuts down:
- Your dev server
- Chrome browser instance
- MCP server
- All monitoring processes

## Common Use Cases

### Use Case 1: Debugging a Production Bug Locally

**Scenario**: A user reported an error, but you can't reproduce it.

**Solution**:
1. Start dev3000 with logging to understand the sequence of events
2. Try to reproduce the issue in the monitored browser
3. Review the consolidated logs in http://localhost:3684/logs
4. Ask AI: `"fix my app"` or `"analyze the error that just occurred"`
5. See the complete timeline: user actions → network calls → errors → screenshots

### Use Case 2: Performance Debugging

**Scenario**: Your app feels slow, but you're not sure where.

**Solution**:
1. Start dev3000 with React Scan plugin enabled:
   ```bash
   dev3000 --plugin-react-scan
   ```
2. Interact with your app normally
3. React Scan will highlight slow-rendering components in the browser
4. Review network timing in logs to identify slow API calls
5. Check screenshots for visual rendering delays

### Use Case 3: Docker/WSL2 Development

**Scenario**: You're developing in Docker or WSL2 and need proper Chrome integration.

**Solution**:
1. Use the Makefile to handle Chrome CDP setup:
   ```bash
   make dev-up    # Starts everything
   make dev-logs  # View logs
   make dev-down  # Stop everything
   ```
2. Chrome runs on your host OS (Windows/macOS) with full GPU acceleration
3. dev3000 runs in the container and connects to host Chrome via `host.docker.internal`

### Use Case 4: Team Debugging Session

**Scenario**: Working with a teammate to debug an issue.

**Solution**:
1. Start dev3000 in your project
2. Reproduce the issue
3. Share your log file (found at `~/.d3k/logs/dev3000-[project]-[timestamp].log`)
4. Teammate can review the exact sequence of events
5. Both can ask AI the same questions using shared log context

### Use Case 5: Integration Testing

**Scenario**: Need to verify browser automation flows work correctly.

**Solution**:
1. Start dev3000 with servers-only mode:
   ```bash
   dev3000 --servers-only
   ```
2. Install the Chrome extension for lightweight monitoring
3. Run your existing Playwright/Cypress tests
4. dev3000 captures all browser activity during tests
5. Review logs to debug test failures

## Configuration

### Environment Variables

dev3000 respects these environment variables:

```bash
# Log file path (default: auto-generated in ~/.d3k/logs/)
export LOG_FILE_PATH="/path/to/custom.log"

# External Chrome CDP URL (for Docker/WSL2)
export DEV3000_CDP_URL="ws://host.docker.internal:9222/devtools/..."

# Skip Chrome launch (use external Chrome)
export DEV3000_CDP_SKIP_LAUNCH=1
```

### Command-Line Options

Full list of options:

```bash
dev3000 [options]

Options:
  -p, --port <port>         Your app's port (default: 3000)
  --mcp-port <port>         MCP server port (default: 3684)
  -s, --script <script>     Package.json script to run (default: dev)
  --browser <path>          Custom browser path
  --servers-only            Skip Chrome launch (use Chrome extension)
  --profile-dir <dir>       Chrome profile directory
  --plugin-react-scan       Enable React performance monitoring
  --debug                   Enable debug logging
  --tail                    Output logs to console in real-time
  --date-time-format <fmt>  Timestamp format: "local" or "utc"
  --no-tui                  Disable TUI interface
```

### Project-Specific Configuration

Create a `.dev3000.json` in your project root:

```json
{
  "port": 3000,
  "mcpPort": 3684,
  "script": "dev",
  "browser": "/Applications/Arc.app/Contents/MacOS/Arc",
  "profileDir": "./chrome-profile",
  "plugins": {
    "reactScan": true
  }
}
```

## Troubleshooting

### Issue: "Port 3000 is already in use"

**Cause**: Another process is using port 3000.

**Solutions**:
```bash
# Option 1: Find and kill the process
lsof -ti:3000 | xargs kill -9

# Option 2: Use a different port
dev3000 --port 3001

# Option 3: Let dev3000 auto-select a port (don't use --port flag)
dev3000  # Will auto-find available port starting from 3000
```

### Issue: "Chrome failed to launch"

**Cause**: Chrome not installed or not in PATH.

**Solutions**:
```bash
# Option 1: Install Chrome
# Visit: https://www.google.com/chrome/

# Option 2: Specify custom browser path
dev3000 --browser "/Applications/Arc.app/Contents/MacOS/Arc"

# Option 3: Use external Chrome (Docker/WSL2)
# On host: Start Chrome with CDP
google-chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0

# In container: Tell dev3000 to use it
export DEV3000_CDP_URL="http://host.docker.internal:9222"
dev3000
```

### Issue: "Logs not showing in UI"

**Cause**: Log file path mismatch between dev3000 and MCP server.

**Solutions**:
```bash
# Check current log file
cat ~/.d3k/logs/dev3000-*  # Should show recent logs

# Verify MCP server can access logs
curl http://localhost:3684/api/logs/stream?logPath=$(ls -t ~/.d3k/logs/dev3000-* | head -1)

# Set explicit log path
export LOG_FILE_PATH="/tmp/d3k.log"
dev3000
```

### Issue: "TUI not rendering correctly"

**Cause**: Terminal doesn't support full TUI features.

**Solutions**:
```bash
# Disable TUI mode
dev3000 --no-tui

# Use tail mode to see logs in console
dev3000 --tail --no-tui
```

### Issue: "MCP server not responding"

**Cause**: Port conflict or server failed to start.

**Solutions**:
```bash
# Check MCP server health
curl http://localhost:3684/health

# Kill existing MCP server
lsof -ti:3684 | xargs kill -9

# Restart with different MCP port
dev3000 --mcp-port 3685
```

### Issue: "Screenshots not appearing"

**Cause**: Screenshot directory permissions or path issues.

**Solutions**:
```bash
# Check screenshot directory
ls -la node_modules/dev3000/mcp-server/public/screenshots/

# Create directory manually if needed
mkdir -p node_modules/dev3000/mcp-server/public/screenshots

# Verify screenshots are being taken
tail -f ~/.d3k/logs/dev3000-* | grep SCREENSHOT
```

## Advanced Features

### Using with Claude Code (AI Integration)

dev3000 automatically configures MCP integration for Claude Code:

1. Start dev3000 in your project
2. Open Claude Code
3. Use AI commands:
   ```
   "fix my app"
   "analyze the error in the logs"
   "what happened before the crash?"
   "create a reproduction case"
   ```

The AI has access to:
- Complete log timeline
- Error messages with stack traces
- Network request/response data
- Screenshots at key moments
- User interaction history

### Dynamic MCP Capability Discovery

dev3000 can orchestrate multiple MCP servers for enhanced debugging:

**Available Integrations**:
- `chrome-devtools` - Advanced browser inspection, DOM analysis
- `nextjs-dev` - Framework-specific build analysis, SSR debugging

**Discover Available MCPs**:
```
# In Claude Code
"What MCP capabilities are available?"
"Show me enhanced debugging options"
```

dev3000 automatically detects and integrates with these MCPs when available.

### Custom Browser Profiles

Maintain separate browser profiles for different projects:

```bash
# Project 1: E-commerce app
cd ~/projects/ecommerce
dev3000 --profile-dir ./chrome-profile-ecommerce

# Project 2: Admin dashboard
cd ~/projects/admin
dev3000 --profile-dir ./chrome-profile-admin
```

Each profile maintains:
- Login sessions
- Cookies and local storage
- Browser extensions
- Bookmarks and history

### Log Rotation and Management

dev3000 automatically manages logs:

- **Retention**: Keeps 10 most recent log files per project
- **Location**: `~/.d3k/logs/dev3000-[project]-[timestamp].log`
- **Format**: Timestamped entries with source tags `[SERVER]` or `[BROWSER]`
- **Search**: Use grep or the MCP search tools
  ```bash
  # Find all errors
  grep "ERROR" ~/.d3k/logs/dev3000-*

  # Find network failures
  grep "NETWORK.*[45][0-9][0-9]" ~/.d3k/logs/dev3000-*
  ```

### Browser Automation and Replay

Execute browser actions programmatically:

**Via Claude Code**:
```
"Click the submit button"
"Navigate to /login"
"Take a screenshot"
"Scroll to the bottom of the page"
```

**Via MCP Tools**:
```javascript
// execute_browser_action tool
{
  "action": "click",
  "x": 100,
  "y": 200
}
```

### Health Monitoring

dev3000 continuously monitors:

1. **App Server Health**: HTTP checks every 10 seconds
2. **MCP Server Health**: Port and endpoint checks
3. **Chrome Process**: Detects crashes and reconnects
4. **Network Activity**: Tracks pending requests

When issues detected:
- Logs detailed diagnostics
- Takes screenshots for context
- Attempts graceful shutdown if critical

### Docker Advanced Configuration

**Custom Dockerfile**:
```dockerfile
FROM node:18-alpine

# Install Chrome dependencies
RUN apk add --no-cache chromium

# Set Chrome path for dev3000
ENV CHROME_BIN=/usr/bin/chromium-browser

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
CMD ["dev3000"]
```

**docker-compose.yml**:
```yaml
version: '3.8'
services:
  dev3000:
    build: .
    ports:
      - "3000:3000"
      - "3684:3684"
    environment:
      - DEV3000_CDP_URL=ws://host.docker.internal:9222
      - LOG_FILE_PATH=/app/logs/consolidated.log
    volumes:
      - ./:/app
      - /app/node_modules
```

---

## Next Steps

Now that you understand dev3000:

1. **Try it in your project**: Start with the Quick Start guide
2. **Explore the Logs UI**: Visit http://localhost:3684/logs
3. **Use AI integration**: Ask Claude Code to "fix my app"
4. **Read the API docs**: Check `docs/` for MCP tool reference
5. **Join the community**: Report issues and share feedback

**Need Help?**
- 📚 Documentation: [README.md](README.md)
- 🐛 Issues: https://github.com/automationjp/dev3000/issues
- 💬 GitHub: https://github.com/automationjp/dev3000

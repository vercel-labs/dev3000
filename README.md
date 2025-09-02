# 🎭 dev-playwright

Feed your AI assistant a delicious stream of development data! dev-playwright captures everything happening in your web app - server logs, browser events, console messages, network requests, and automatic screenshots - all in one unified, timestamped feed that Claude (and other AI assistants) can easily digest.

## 🧠 Why this exists

Ever tried to debug an issue with Claude but struggled to explain what was happening? Or spent forever trying to reproduce a bug that only happens in specific conditions?

dev-playwright creates a complete visual + textual timeline of your development session that AI assistants can understand instantly. Claude can see your server logs, browser console, network requests, AND screenshots all in chronological order.

It's like having a development photographer + stenographer + AI whisperer all in one tool! 📸🤖

## ✨ What makes this special?

🎬 **Visual Timeline** - Screenshots automatically captured on navigation, errors, and key events  
📊 **Unified Logs** - Server output + browser console + network requests in chronological order  
🔍 **Smart Monitoring** - Watches your app in a real browser, catching what dev tools miss  
🌐 **Beautiful Web UI** - View logs with inlined screenshots at `http://localhost:3684/logs`  
🤖 **AI-Ready** - MCP server lets Claude read logs and analyze issues instantly  
⚡ **Zero Config** - One command, works with any web framework

## 🚀 Quick Start

```bash
# Install in your project
pnpm install dev-playwright


# Start in a terminal (default: runs "pnpm run dev",  port 3000)
# Logs will be written to a file path for you to give to claude or tail -f yourself
pnpx dev-playwright


# Or specify a different build script and port
pnpx dev-playwright --script build-start --port 3001

```

That's it! dev-playwright will:

1. 🔍 Check if your ports (3000, 3684) are available
2. 🚀 Start your dev server (any npm script you want)
3. 🌐 Launch a monitored browser pointing to your app
4. 📸 Take screenshots on navigation, errors, and key events
5. 📊 Create a beautiful log viewer with visual timeline
6. 🤖 Serve MCP tools for AI assistants

**Note:** If ports are already in use, dev-playwright will show you which processes are using them and provide the exact command to free them up.

## 🎯 Perfect for...

- **Debugging with Claude** - Show Claude exactly what happened with visual context
- **Issue reproduction** - Visual timeline of user interactions leading to bugs
- **Performance monitoring** - See network requests alongside visual changes
- **Team debugging** - Share visual debugging timelines with screenshots
- **Development documentation** - Automatic visual history of your app's behavior

## 🖼️ Visual Log Viewer

Visit `http://localhost:3684/logs` to see your development timeline with:

- **📸 Inlined screenshots** showing exactly what users saw
- **⚡ Virtual scrolling** for massive log files
- **🔴 Live tail mode** with real-time updates
- **🔍 Head/tail commands** like Unix utilities
- **🎨 Syntax highlighting** for different log types

## 🤖 AI Assistant Integration

Claude can read your logs directly or use the MCP server for advanced querying:

**Direct log access:**

```
Read /tmp/dev-playwright-consolidated.log
```

**MCP tools** (at `http://localhost:3684/api/mcp/http`):

- `read_consolidated_logs` - Get recent logs with filtering
- `search_logs` - Regex search with context
- `get_browser_errors` - Extract browser errors by time period

## 🛠️ Command Options

```bash
pnpx dev-playwright [options]

Options:
  -p, --port <port>         Your app's port (default: 3000)
  --mcp-port <port>         MCP server port (default: 3684)
  -s, --script <script>     Package.json script to run (default: dev)
  --profile-dir <dir>       Chrome profile directory (persists cookies/login state)
  --log-file <file>         Log file path
```

## 🎨 Examples

```bash
# Default Next.js development
pnpx dev-playwright

# Production build testing
pnpx dev-playwright --script build-start

# Custom port
pnpx dev-playwright --script dev --port 3001

# Vite app
pnpx dev-playwright --script dev --port 5173

# Custom build setup
pnpx dev-playwright --script "build && serve" --port 8080

# Persistent login state (saves cookies/sessions)
pnpx dev-playwright --profile-dir ./chrome-profile
```

## 🎪 What you'll see

Your terminal becomes a live feed of everything:

```
🔍 Checking port 3000...
🔍 Checking port 3684...
🚀 Starting development environment...
🔧 Starting server: pnpm run dev
🤖 Starting MCP server on port 3684...
⏳ Waiting for server to be ready...
✅ Server is ready!
✅ MCP server is ready!
🌐 Starting playwright for browser monitoring...
✅ Browser monitoring active!

✅ Development environment ready!
📊 Logs: /tmp/dev-playwright-consolidated.log
🌐 Your App: http://localhost:3000
🤖 MCP Server: http://localhost:3684/api/mcp/http
📸 Visual Timeline: http://localhost:3684/logs
```

## 📸 Screenshot Magic

Screenshots are automatically captured and inlined in logs for:

- ✅ Initial page load
- ✅ Route changes
- ✅ JavaScript errors
- ✅ Network failures (4xx, 5xx responses)

Each screenshot shows exactly what the user was seeing when events occurred!

---

_Made with <3 by [elsigh](https://github.com/elsigh) & [Claude](https://claude.ai)_

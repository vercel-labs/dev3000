# d3k Chrome Extension

A Chrome extension that captures unified development logs via the `chrome.debugger` API and sends them to the same MCP server as the Playwright implementation, enabling seamless browser monitoring without special startup requirements.

## Features

- **🔄 Unified Logging**: Sends browser logs to the same `/tmp/dev3000.log` file as Playwright implementation
- **🎯 Automatic Detection**: Auto-detects and attaches to development servers (configurable ports)
- **📊 Real-time Monitoring**: Console logs, network requests, navigation, errors, and performance data
- **🏷️ Multi-Tab Identification**: Each tab gets a unique identifier (e.g., `[TAB-1.0]`, `[TAB-1.1]`)
- **🌐 MCP Server Integration**: Connects to localhost:3684 for AI-powered debugging
- **⚡ No Special Setup**: No need to start Chrome with `--remote-debugging-port`

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this `chrome-extension` directory
4. The extension will appear in your toolbar

## Usage

### **With MCP Server (Recommended)**
1. Start your dev server: `pnpm dev` or `dev3000`
2. Navigate to your app (e.g., `http://localhost:3031`)
3. Extension auto-attaches (or click "Attach to Tab")
4. **View unified logs**: [localhost:3684/logs](http://localhost:3684/logs)
5. **AI debugging**: `Read /tmp/dev3000.log` in Claude

### **Extension Only Mode**
- Works without MCP server running
- Logs stored in extension popup only
- Status shows "MCP Server: Offline"

## Architecture

### Background Script (`background.js`)
- Uses `chrome.debugger.attach()` to connect to tabs via CDP
- Enables monitoring domains: Runtime, Network, Page, DOM, Performance, Security, Log
- Processes CDP events and formats them into unified log entries
- Stores logs in memory and chrome.storage for persistence
- Provides API for popup and content scripts

### Content Script (`content.js`)
- Injected into all pages to provide additional monitoring
- Monitors performance, DOM changes, errors, and fetch requests
- Communicates with background script via message passing
- Provides fallback monitoring for cases where CDP isn't available

### Popup Interface (`popup.html` + `popup.js`)
- Shows current tab status and monitoring state
- Displays real-time logs with syntax highlighting
- Provides search functionality with regex support
- Controls for attaching/detaching from tabs

## Unified Log Format

Browser logs from the extension are interleaved with server logs in `/tmp/dev3000.log`:

```
[2025-09-08T21:45:37.434Z] [SERVER] Ready on http://localhost:3031
[2025-09-08T21:45:38.123Z] [TAB-1.0] [ATTACH] Monitoring started - My App (http://localhost:3031)
[2025-09-08T21:45:38.124Z] [TAB-1.0] [INFO] User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...
[2025-09-08T21:45:38.456Z] [TAB-1.0] [BROWSER] [CONSOLE LOG] DEV3000_TEST: Simple script execution working!
[2025-09-08T21:45:38.789Z] [TAB-1.1] [BROWSER] [NETWORK RESPONSE] 200 OK http://localhost:3031/api/data (XHR) [application/json]
```

**Multi-Tab Support**: Each tab gets a unique identifier like `[TAB-1.0]` (Window 1, Tab 0).

## Comparison with Playwright Implementation

| Feature | Playwright CDP | Chrome Extension |
|---------|----------------|------------------|
| Console Logs | ✅ | ✅ |
| Network Monitoring | ✅ | ✅ |
| Page Navigation | ✅ | ✅ |
| Error Handling | ✅ | ✅ |
| Performance Data | ✅ | ✅ |
| Screenshots | ✅ | ❌* |
| Persistent Sessions | ✅ | ❌** |
| Cross-Tab Monitoring | ✅ | ✅ |

*Screenshots require additional permissions and APIs
**Sessions end when extension is reloaded or browser closed

## Development

To modify the extension:

1. Make changes to the source files
2. Click the reload button for the extension in `chrome://extensions/`
3. Test with development servers

## Permissions

- `debugger`: Core CDP access
- `activeTab`: Access current tab information  
- `storage`: Persist logs and settings
- `tabs`: Monitor tab changes and attach to development servers

## Limitations

- Chrome extensions have stricter security policies than Node.js applications
- Cannot take screenshots without additional permissions
- Limited to Chrome browser (no Firefox/Safari support)
- Sessions don't persist across browser restarts
- Some advanced CDP features may not be accessible
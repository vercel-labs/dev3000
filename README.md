# dev3000

Captures your web app's complete development timeline - server logs, browser events, console messages, network requests, and automatic screenshots - in a unified, timestamped feed for AI debugging.

## Quick Start

```bash
pnpm install -g dev3000
dev3000
```

## AI Integration

**You should connect claude code or any AI tool to the mcp-server to have it issue commands to the browser.**

```bash
claude mcp add -t http -s user dev3000 http://localhost:3684/mcp
```

Then issue the following prompt:

```
Use dev3000 to debug my app
```

![dev3000 CLI](www/public/cli.gif)

## What it does

Creates a comprehensive log of your development session that AI assistants can easily understand. When you have a bug or issue, Claude can see your server output, browser console, network requests, and screenshots all in chronological order.

The tool monitors your app in a real browser and captures:

- Server logs and console output
- Browser console messages and errors
- Network requests and responses
- Automatic screenshots on navigation, errors, and key events
- Visual timeline at `http://localhost:3684/logs`

![dev3000 Logs Viewer](logs.jpg)

Logs are automatically saved with timestamps in `/var/log/dev3000/` (or temp directory) and rotated to keep the 10 most recent per project. Each instance has its own timestamped log file displayed when starting dev3000.

### MCP Integration Notes

The MCP server at `http://localhost:3684/mcp` supports the HTTP prototcol (not stdio) as well as the following commands for advanced querying:

- `read_consolidated_logs` - Get recent logs with filtering
- `search_logs` - Regex search with context
- `get_browser_errors` - Extract browser errors by time period
- `execute_browser_action` - Control the browser (click, navigate, screenshot, evaluate, scroll, type)

**Cursor**:

```js
{
  "mcpServers": {
      "dev3000": {
          "type": "http",
          "url": "http://localhost:3684/mcp"
      }
  }
}
```

## Using the Chrome Extension vs Playwright

dev3000 supports two monitoring modes:

### Default: Playwright Browser Automation

By default, dev3000 launches a Playwright-controlled Chrome instance for comprehensive monitoring.

### Alternative: Chrome Extension

For a lighter approach, install the dev3000 Chrome extension to monitor your existing browser session.

#### Installing the Chrome Extension

Since the extension isn't published to the Chrome Web Store, install it locally:

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Navigate to your dev3000 installation directory and select the `chrome-extension` folder
5. The extension will now monitor localhost tabs automatically

#### Using with --servers-only

When using the Chrome extension, start dev3000 with the `--servers-only` flag to skip Playwright:

```bash
dev3000 --servers-only
```

#### Comparison

| Feature             | Playwright (Default)     | Chrome Extension        |
| ------------------- | ------------------------ | ----------------------- |
| **Setup**           | Automatic                | Manual install required |
| **Performance**     | Higher resource usage    | Lightweight             |
| **Browser Control** | Full automation support  | Monitoring only         |
| **User Experience** | Separate browser window  | Your existing browser   |
| **Screenshots**     | Automatic on events      | Manual via extension    |
| **Best For**        | Automated testing, CI/CD | Development debugging   |

## Options

```bash
dev3000 [options]

  -p, --port <port>         Your app's port (default: 3000)
  --mcp-port <port>         MCP server port (default: 3684)
  -s, --script <script>     Package.json script to run (default: dev)
  --browser <path>          Full path to browser executable (e.g. Arc, custom Chrome)
  --servers-only            Run servers only, skip browser launch (use with Chrome extension)
  --profile-dir <dir>       Chrome profile directory (default: /tmp/dev3000-chrome-profile)
```

Examples:

```bash
# Custom port
dev3000 --port 5173

# Use Arc browser
dev3000 --browser '/Applications/Arc.app/Contents/MacOS/Arc'

# Use with Chrome extension (no Playwright)
dev3000 --servers-only

# Custom profile directory
dev3000 --profile-dir ./chrome-profile
```

---

_Made by [elsigh](https://github.com/elsigh)_

## Contributing

We welcome pull requests (PRs) from the community!

Before submitting a PR:

- **Pull the latest changes** from `main`.
- **Run** `scripts/canary.sh` to test your feature locally and verify what is already in the canary build.
- **Tip** `dev3000 --version` to verify you're on the canary locally
- **FYI** .husky/pre-commit.sh runs `pnpm format` to apply biome.json rules to all code
- Please run and test the canary build locally to avoid duplicating work that may already be done.

### For Maintainers

See [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md) for detailed release instructions.

# dev3000

![dev3000 terminal interface](./www/public/hero-terminal.png)

Captures your web app's complete development timeline - server logs, browser events, console messages, network requests, and automatic screenshots - in a unified, timestamped feed for AI debugging. **Gracefully enhances with chrome-devtools and nextjs-dev MCPs when available.**

## Quick Start

```bash
pnpm install -g dev3000
dev3000
```

## AI Integration with Dynamic Enhancement

**dev3000 features smart MCP integration that gracefully enhances capabilities when specialized MCPs are available!**

### 🎯 Core Experience (Always Available)
When you run `dev3000`, you get:
- **dev3000 MCP** - Complete debugging and browser automation tools
- Full log analysis, error detection, interaction replay
- Comprehensive browser automation and screenshot capture

### ⚡ Enhanced Experience (When Available)
dev3000 **automatically discovers** and integrates with:
- **chrome-devtools MCP** - Advanced browser inspection, DOM analysis, performance profiling
- **nextjs-dev MCP** - Framework-specific build analysis, SSR debugging, hydration troubleshooting

### 🚀 Dynamic Capability Discovery
- **Real-time detection** of available MCP capabilities via log introspection
- **Context-aware suggestions** that match your current debugging scenario  
- **Zero manual configuration** - works out of the box
- **Intelligent caching** (5min TTL) for optimal performance
- **Self-updating** - automatically adapts when MCPs add new features

For **Claude Code**, no manual setup is required. Just run `dev3000` and start using AI commands:

```
fix my app
```

dev3000 will provide comprehensive analysis and, when enhanced MCPs are available, suggest additional capabilities like:
```
🔗 AUGMENTED ANALYSIS AVAILABLE

dev3000 provided the core log analysis above. For deeper insights, consider also gathering:

Next.js Framework Analysis:
• dev3000-nextjs-dev:debug_hydration() - Client-server hydration analysis
• dev3000-nextjs-dev:analyze_build_process() - Deep build system insights

Browser-Side Analysis:
• dev3000-chrome-devtools:inspect_element() - Deep DOM inspection
• dev3000-chrome-devtools:start_performance_profile() - Client-side performance data

💡 Best approach: Use dev3000's log analysis as your foundation, then gather specific additional data as needed for a complete picture.
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

## dev3000: Smart Debugging Orchestrator

**dev3000 doesn't just work alone - it's designed to intelligently enhance its capabilities by orchestrating your entire MCP debugging ecosystem!** 🎼

### 🎯 How Smart Integration Works

**Core Mode** (dev3000 alone):
- Complete log analysis, browser automation, error detection, interaction replay
- All essential debugging functionality available immediately
- Zero dependencies - works great out of the box

**Enhanced Mode** (with specialized MCPs):
- **Dynamic Discovery**: Real-time detection of available MCP capabilities via log introspection
- **Capability-Aware Suggestions**: Context-sensitive recommendations based on discovered MCP functions  
- **Augmented Delegation**: Provides comprehensive dev3000 analysis PLUS enhanced MCP suggestions
- **Self-Updating Intelligence**: Automatically adapts when MCPs add new capabilities - no manual updates required

### 🚀 Key Innovation: Dynamic Capability Discovery

Unlike static integrations that become outdated, dev3000 features **living integration** that:

- **Introspects MCP Logs**: Analyzes Claude's MCP communication logs to discover available functions
- **Pattern Recognition**: Uses intelligent regex patterns to extract function names and descriptions
- **Smart Categorization**: Automatically classifies capabilities as "advanced" vs "basic"
- **Context Matching**: Prioritizes suggestions based on current error patterns
- **Cache Intelligence**: 5-minute caching for performance with automatic refresh

**Result**: You always get suggestions for the **latest available capabilities** from your MCPs, even when they update with new features you haven't seen yet!

### 🚀 Integration Benefits

**With nextjs-dev MCP:**
- Framework-specific build and runtime error analysis
- Server-side log correlation with dev3000's client-side data
- Next.js-specific fix suggestions (hydration, SSR, etc.)

**With chrome-devtools MCP:**
- Precise browser state inspection and control
- Detailed console error analysis beyond dev3000's capture
- DOM inspection for UI interaction failures

**Triple-Stack Power (dev3000 + nextjs-dev + chrome-devtools):**
- Complete full-stack debugging coverage
- AI-powered error correlation across all layers
- 90%+ issue resolution rate through systematic workflows

### 📋 Smart Integration Tools

**`fix_my_app`** - Enhanced with dynamic capability discovery
- Provides comprehensive dev3000 log analysis  
- Automatically suggests relevant enhanced MCP functions based on discovered capabilities
- Context-aware suggestions that match current error patterns
- Returns structured data for orchestration when needed

**`get_mcp_capabilities`** - NEW! Inspect your MCP ecosystem
```bash
# In Claude Code
"Show me what MCP capabilities are currently available"
```
- Displays all discovered functions from available MCPs
- Shows capability categories (advanced vs basic)  
- Reveals cache status and discovery timestamps
- Perfect for debugging MCP integration issues

**`execute_browser_action`** - Now capability-aware
- Performs dev3000 browser automation (clicks, navigation, screenshots)
- Suggests enhanced MCP capabilities when relevant
- Context-specific recommendations based on the action performed

**`discover_available_mcps`** - Find what MCPs are running
```bash
# In Claude Code
"What MCPs are available for integration?"
```

**`create_integrated_workflow`** - Generate systematic debugging plans
```bash
# In Claude Code  
"Create an integrated debugging workflow for my Next.js app"
```

### 🔍 Proactive Discovery

dev3000 can automatically discover other MCPs without manual configuration:

**Process Detection**: Scans for known MCP patterns in running processes
**Port Pinging**: Tests standard MCP ports with health checks
**Smart Logging**: All discovery attempts logged with `[D3K]` tags

```
[2025-01-XX] [D3K] MCP Discovery: Found nextjs-dev MCP via process detection
[2025-01-XX] [D3K] MCP Integration: Activated integrations [Next.js, Chrome DevTools]  
[2025-01-XX] [D3K] Fix Analysis: Using active MCP integrations for enhanced error analysis
```

**The result**: Instead of using debugging tools individually, you get an **orchestrated workflow** that leverages each tool's unique strengths systematically! 🎼

### MCP Server Details

The MCP server runs at `http://localhost:3684/mcp` and provides these tools:

- `fix_my_app` - **Enhanced!** AI-powered debugging with dynamic MCP capability suggestions
- `execute_browser_action` - **Enhanced!** Browser automation with context-aware MCP recommendations  
- `get_mcp_capabilities` - **NEW!** Inspect available MCP ecosystem capabilities in real-time
- `discover_available_mcps` - Find running MCPs via process detection and port pinging
- `create_integrated_workflow` - Generate systematic multi-MCP debugging plans
- `get_shared_cdp_url` - Get CDP WebSocket URL for browser coordination
- `read_consolidated_logs` - Get recent logs with filtering
- `search_logs` - Regex search with context  
- `get_browser_errors` - Extract browser errors by time period

**Automatic Configuration**: Claude Code users get MCP access automatically when running `dev3000`. The dynamic capability discovery works with any MCPs you have configured - no manual setup required!



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
  -c, --command <command>   Custom command to run (overrides auto-detection and --script)
  --browser <path>          Full path to browser executable (e.g. Arc, custom Chrome)
  --servers-only            Run servers only, skip browser launch (use with Chrome extension)
  --profile-dir <dir>       Chrome profile directory (default: /tmp/dev3000-chrome-profile)
```

Examples:

```bash
# Custom port
dev3000 --port 5173

# Custom command (skip auto-detection)
dev3000 --command "bun run dev"

# Custom Python server
dev3000 --command "uvicorn main:app --reload" --port 8000

# Use Arc browser
dev3000 --browser '/Applications/Arc.app/Contents/MacOS/Arc'

# Use with Chrome extension (no Playwright)
dev3000 --servers-only

# Custom profile directory
dev3000 --profile-dir ./chrome-profile
```

## Frequently Asked Questions

### Does dev3000 save my login state?

Yes, login state is saved automatically in a unique browser profile for each project. No need to re-login.

### How do I stop a dev3000 session?

Press `Ctrl+C` to stop everything (server, browser, and MCP server).

### Does dev3000 work with other frameworks besides Next.js?

Yes, it works with React, Vue, Vite, etc. Use `--script` to specify your dev command.

### Why do I see a warning about "sharp" during installation?

This warning is harmless and can be safely ignored. Sharp is an optional image optimization library used by Next.js, but dev3000 has image optimization disabled (`images: { unoptimized: true }` in next.config.mjs) since all images are served locally. The warning appears because pnpm wants to run sharp's build script, but the library is never actually used at runtime.

---

_Made by [elsigh](https://github.com/elsigh)_

## Contributing

We welcome contributions! Here's how to get started:

### Testing Your Changes Locally

Use the canary script to build and test your changes on your machine:

```bash
./scripts/canary.sh
```

This will:
- Build the project (including MCP server)
- Create a local package
- Install it globally for testing
- You can verify with `dev3000 --version` (should show canary version)

### Before Submitting a PR

- **Pull the latest changes** from `main`
- **Run the canary build** to test your changes: `./scripts/canary.sh`
- **Ensure tests pass**: `pnpm test`
- **Note**: Pre-commit hooks will automatically format your code with Biome

### Development Tips

- Use `pnpm run lint` to check code style
- Use `pnpm run typecheck` for TypeScript validation
- The canary script is the best way to test the full user experience locally

### Testing

- `pnpm test` - Run unit tests
- `pnpm run test-clean-install` - Test clean installations in isolated environments
- `pnpm run test-release` - Run comprehensive release tests (includes all of the above plus build, pack, and MCP server tests)

## Releasing (Maintainers Only)

We use a semi-automated release process that handles testing while accommodating npm's 2FA requirement:

### Option 1: GitHub Actions + Manual Publish (Recommended)

1. Go to [Actions](https://github.com/vercel-labs/dev3000/actions) → "Prepare Release"
2. Select release type (patch/minor/major) and run
3. Wait for tests to pass on all platforms
4. Download the release artifact (tarball)
5. Publish locally: `./scripts/publish.sh dev3000-*.tgz`

### Option 2: Local Release

```bash
./scripts/release.sh  # Creates tag and updates version
./scripts/publish.sh  # Publishes to npm (requires 2FA)
git push origin main --tags
```

The release script automatically handles re-releases by cleaning up existing tags if needed.

For detailed instructions, see [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md).

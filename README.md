# dev3000

![dev3000 terminal interface](./www/public/hero-terminal.png)

Captures your web app's complete development timeline - server logs, browser events, console messages, network requests, and automatic screenshots - in a unified, timestamped feed for AI debugging. **Gracefully enhances with chrome-devtools and nextjs-dev MCPs when available.**

> **Note**: This is a fork of [vercel-labs/dev3000](https://github.com/vercel-labs/dev3000) optimized for Docker-based development with Alpine Linux, enhanced health checks, and simplified deployment workflows. We're grateful to the original developers for creating this amazing debugging tool!

## Quick Start (Docker)

### Prerequisites

Before starting, ensure you have:
- **Docker Desktop** installed and running
- **Git** installed
- **Chrome browser** installed (for CDP monitoring)
- **WSL2** enabled (Windows users)
- **Make** utility (usually pre-installed on Linux/Mac)

### Option 1: Try with Example App (Recommended for First-Time Users)

**Complete step-by-step guide to run dev3000 + Next.js 16:**

```bash
# 1. Clone this repository
git clone https://github.com/automationjp/dev3000.git
cd dev3000

# 2. Initialize git submodules (if any)
git submodule update --init --recursive

# 3. Deploy Next.js 16 example to frontend/
make deploy-frontend APP=nextjs16

# 4. Configure environment (optional - has sensible defaults)
# Copy .env.example to .env and customize if needed
cp .env.example .env
# Default settings work for most environments:
#   DEV3000_CDP_PROXY=socat (enables localhost CDP forwarding)
#   DEV3000_CDP_URL=http://host.docker.internal:9222

# 5. Start Chrome with CDP enabled on host machine
# This is REQUIRED for dev3000 to monitor browser events

# On Windows (PowerShell):
Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222','--remote-debugging-address=0.0.0.0','--user-data-dir=C:\temp\chrome-dev-profile','http://localhost:3000'

# On macOS:
open -a "Google Chrome" --args --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000

# On Linux:
google-chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000 &

# Or use the Makefile command (auto-detects platform):
make start-chrome-cdp

# 6. Build Docker image with dev3000 + Next.js
make dev-rebuild

# 7. Start the development environment
make dev-up

# ✅ That's it! Your app is now running with dev3000 monitoring

# Access points:
#   - Next.js App:    http://localhost:3000
#   - dev3000 Logs:   http://localhost:3684/logs
#   - MCP Server:     http://localhost:3684
#   - Chrome CDP:     http://localhost:9222/json/version
```

**Or deploy and start in one command:**
```bash
make deploy-and-start APP=nextjs16
# Then start Chrome CDP manually (see step 5 above)
```

**Verify everything is working:**
```bash
# Check CDP connection
curl http://localhost:9222/json/version

# Check container status
make status

# View logs
make dev-logs
```

### Option 2: Use with Your Own Project (Production Use)

**Integrate dev3000 into your existing Next.js project:**

```bash
# 1. Navigate to your project's frontend directory
cd /path/to/your-project/frontend

# 2. Add dev3000 as a git submodule
git submodule add https://github.com/automationjp/dev3000 .dev3000

# 3. For WSL2: Disable symlinks due to Windows path length limitations
cd .dev3000
git config core.symlinks false
git checkout -f
cd ..

# 4. Copy reference files from dev3000 to your project
mkdir -p scripts
cp .dev3000/example/nextjs16/reference/scripts/docker-entrypoint.sh scripts/
cp .dev3000/example/nextjs16/reference/Dockerfile.dev ./
cp .dev3000/example/nextjs16/reference/.npmrc ./
cp .dev3000/example/nextjs16/reference/docker-compose.yml ../
cp .dev3000/example/nextjs16/reference/Makefile ../
cp .dev3000/example/nextjs16/reference/.env.example ../.env

# 5. Customize .env for your environment (if needed)
cd ..
nano .env  # Edit CDP URL if not using host.docker.internal

# 6. Start Chrome with CDP (same as Option 1, step 5)
make start-chrome-cdp

# 7. Build and start from project root
cd ..
make dev-rebuild
make dev-up
```

The development environment will start:
- **Next.js App**: http://localhost:3000
- **Dev3000 UI**: http://localhost:3684
- **Logs Viewer**: http://localhost:3684/logs

### Available Commands

```bash
# Deployment
make list-examples          # List available example apps
make deploy-frontend APP=nextjs16  # Deploy specific example
make deploy-and-start APP=nextjs16 # Deploy and start in one command
make clean-frontend         # Clean frontend directory (keeps only .keep)

# Development
make dev-up                 # Start development environment
make dev-down               # Stop development environment
make dev-logs               # Follow container logs
make dev-rebuild            # Rebuild Docker image (use after code changes)
make dev-rebuild-fast       # Fast rebuild with cache

# Monitoring
make status                 # Show environment status
make start-chrome-cdp       # Manually start Chrome with CDP
make stop-chrome-cdp        # Stop Chrome CDP process

# Update workflow
make dev3000-sync           # Update dev3000 submodule to latest
make dev-rebuild-frontend   # Rebuild frontend image only (fast)
```

## Troubleshooting

### Chrome CDP Connection Issues

**Symptom:** dev3000 cannot connect to Chrome, WebSocket errors in logs

**Solutions:**

1. **Verify Chrome is running with CDP:**
   ```bash
   curl http://localhost:9222/json/version
   ```
   Should return JSON with Chrome version info.

2. **Check if Chrome CDP is accessible from Docker:**
   ```bash
   docker exec dev3000 curl http://host.docker.internal:9222/json/version
   ```

3. **Restart Chrome with correct flags:**
   ```bash
   # Close all Chrome instances first
   make stop-chrome-cdp

   # Start Chrome with CDP enabled
   make start-chrome-cdp
   ```

4. **Verify socat proxy is running inside container:**
   ```bash
   docker exec dev3000 ps aux | grep socat
   # Should show: socat TCP-LISTEN:9222,reuseaddr,fork TCP:host.docker.internal:9222
   ```

5. **Check environment variables:**
   ```bash
   docker exec dev3000 env | grep CDP
   # Should show:
   #   DEV3000_CDP=1
   #   DEV3000_CDP_URL=http://localhost:9222
   #   DEV3000_CDP_PROXY=socat
   ```

### Port Conflicts

**Symptom:** "Port already in use" errors

**Solution:**
```bash
# Check which process is using the port
lsof -i :3000  # Next.js port
lsof -i :3684  # dev3000 MCP port
lsof -i :9222  # Chrome CDP port

# Stop conflicting services
make dev-down
```

### Docker Build Failures

**Symptom:** "Cannot find module" or symlink errors during build

**Solution:**
```bash
# Clean rebuild without cache
make dev-rebuild

# If node_modules symlink issues persist:
make clean-frontend
make deploy-frontend APP=nextjs16
make dev-rebuild
```

### WSL2 Specific Issues

**Problem 1: Permission errors with pnpm install**

**Solution:** Use temporary directories to bypass WSL mount restrictions:
```bash
cd frontend/.dev3000
PNPM_HOME=/tmp/.pnpm-home pnpm install --store-dir /tmp/.pnpm-store --no-frozen-lockfile
```

**Problem 2: File watching not working (hot reload broken)**

**Solution:** Already configured in docker-compose.yml:
```yaml
environment:
  - CHOKIDAR_USEPOLLING=true
  - WATCHPACK_POLLING=true
```

**Problem 3: host.docker.internal not resolving**

**Solution:** Manually set host IP in .env:
```bash
# Get WSL2 host IP
ip route | grep default | awk '{print $3}'

# Update .env
DEV3000_CDP_URL=http://172.17.0.1:9222  # Use your actual host IP
```

### Container Won't Start

**Symptom:** Container exits immediately or fails health check

**Solutions:**

1. **Check logs:**
   ```bash
   make dev-logs
   ```

2. **Verify frontend/ directory exists:**
   ```bash
   ls -la frontend/
   # Should contain: package.json, app/, .dev3000/, etc.
   ```

3. **Check Docker resources:**
   - Ensure Docker has at least 4GB RAM allocated
   - Ensure enough disk space (5GB+ recommended)

4. **Verify entrypoint.sh is executable:**
   ```bash
   ls -l frontend/scripts/docker-entrypoint.sh
   # Should show: -rwxr-xr-x (executable)
   ```

### Still Having Issues?

1. **Check full system status:**
   ```bash
   make status
   ```

2. **View detailed logs:**
   ```bash
   make dev-logs
   ```

3. **Report an issue:**
   - GitHub Issues: https://github.com/automationjp/dev3000/issues
   - Include: OS, Docker version, error logs, output of `make status`

## AI Integration with Dynamic Enhancement

**dev3000 features smart MCP integration that gracefully enhances capabilities when specialized MCPs are available!**

### 🎯 Core Experience (Always Available)
When you run dev3000, you get:
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

For **Claude Code**, no manual setup is required. Just run dev3000 and start using AI commands:

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

Logs are automatically saved with timestamps in `~/.d3k/logs/` and rotated to keep the 10 most recent per project. Each instance has its own timestamped log file displayed when starting dev3000.

## 📚 Documentation

Comprehensive documentation is available in the `/docs` directory:

### User Guides
- **[Getting Started](docs/user-guide/getting-started.md)** - Complete guide from installation to debugging
- **[Docker Setup](docs/user-guide/docker-setup.md)** - Running dev3000 in Docker (Windows/WSL2/Linux/macOS)
- **[MCP Setup](docs/user-guide/mcp-setup.md)** - AI integration with Claude Code
- **[Performance Guide](docs/user-guide/performance.md)** - Optimization tips

### Developer Documentation
- **[Documentation Index](docs/README.md)** - Complete documentation navigation
- **[Claude Code Guide](CLAUDE.md)** - Development guidelines for Claude Code (root level)
- **[Release Process](docs/developer/release-process.md)** - How to release new versions
- **[Changelog Management](docs/developer/changelog-management.md)** - How the changelog system works

### Component Documentation
- [Chrome Extension](chrome-extension/README.md) - Browser extension setup
- [Docker Setup Guide](docs/user-guide/docker-setup.md) - Docker configuration and architecture
- [Example Apps](example/nextjs16/README.md) - Sample applications and integration guide

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

**Automatic Configuration**: Claude Code users get MCP access automatically when running dev3000. The dynamic capability discovery works with any MCPs you have configured - no manual setup required!

## Docker Environment

This repository uses Docker for consistent development across platforms (WSL2, Linux, macOS).

### Architecture
- **Alpine Linux base** - Lightweight and optimized
- **GNU coreutils** - Full dev3000 compatibility
- **HTTP health checks** - Robust container monitoring
- **Volume mounts** - Hot reload for development

### Requirements
- Docker and Docker Compose
- Make (for convenience commands)
- WSL2 (for Windows users)

For detailed Docker setup instructions, see [Docker Setup Guide](docs/user-guide/docker-setup.md).

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

## Frequently Asked Questions

### Does dev3000 save my login state?

Yes, login state is saved automatically in a unique browser profile for each project. No need to re-login.

### How do I stop a dev3000 session?

Use `make dev-down` to stop the development environment, or `Ctrl+C` in the terminal running dev3000.

### Does dev3000 work with other frameworks besides Next.js?

Yes, it works with React, Vue, Vite, etc. Deploy your own app by copying it to the `frontend/` directory and rebuilding.

### Why do I see a warning about "sharp" during installation?

This warning is harmless and can be safely ignored. Sharp is an optional image optimization library used by Next.js, but dev3000 has image optimization disabled (`images: { unoptimized: true }` in next.config.mjs) since all images are served locally. The warning appears because pnpm wants to run sharp's build script, but the library is never actually used at runtime.

## Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/automationjp/dev3000.git
cd dev3000

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Run tests
pnpm test
```

### Testing Your Changes

Test your changes in Docker:

```bash
# Rebuild Docker image with your changes
make dev-rebuild

# Check logs
make dev-logs

# Test in different scenarios
make deploy-and-start APP=nextjs16
```

### Before Submitting a PR

- **Pull the latest changes** from `main`
- **Ensure tests pass**: `pnpm test`
- **Run linting**: `pnpm run lint`
- **Check types**: `pnpm run typecheck`
- **Note**: Pre-commit hooks will automatically format your code with Biome

### Testing

- `pnpm test` - Run unit tests
- `pnpm run test-clean-install` - Test clean installations in isolated environments
- `pnpm run test-release` - Run comprehensive release tests

## License

MIT

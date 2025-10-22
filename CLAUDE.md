# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**NOTE**: CLAUDE.md is symlinked to AGENTS.md as the source of truth. Any edits to either file will affect both.

## Core Development Rules

**NEVER RUN**:
- Do not run `pnpm build` or `pnpm dev` during development - the user tests manually.
- Do not run any of the scripts in the scripts/ directory unless explicitly asked to.

**ALWAYS RUN**: When completing any code changes, you MUST run:
- `pnpm run lint` - Fix all linting errors before committing
- `pnpm run typecheck` - Fix all TypeScript errors before committing
- Never bypass pre-commit hooks or use --no-verify. Fix all issues until the code passes.

**PACKAGE MANAGER**: This project uses pnpm exclusively with workspaces. Never use npm or yarn.

**TURBOPACK**: NEVER disable turbopack in favor of webpack. This project uses turbopack exclusively for Next.js builds.

## Project Architecture

### Core Concept
dev3000 is a comprehensive development monitoring tool that captures everything happening in a web application (server logs, browser events, network activity, screenshots) in a unified timeline for AI-powered debugging. It acts as a "black box recorder" for development environments.

### Monorepo Structure
This is a pnpm workspace with three main packages:
- **Root package** (`package.json`) - Main dev3000 CLI and core functionality
- **`mcp-server/`** - Next.js app serving the MCP endpoint and UI (http://localhost:3684)
- **`www/`** - Marketing/documentation website (optional)

### Key Entry Points and Flow

**CLI Entry** (`src/cli.ts`):
- Detects project type (Node.js/Python/Rails)
- Auto-detects package manager (pnpm/npm/yarn/bun)
- Parses command-line options
- Delegates to `startDevEnvironment()` from `dev-environment.ts`

**Dev Environment Orchestrator** (`src/dev-environment.ts`):
- Spawns user's dev server (e.g., `pnpm run dev`)
- Launches Chrome with CDP (Chrome DevTools Protocol) enabled
- Starts MCP server (Next.js app at port 3684)
- Coordinates log consolidation from all sources
- Manages browser profile persistence (login state, cookies, etc.)

**CDP Monitor** (`src/cdp-monitor.ts`):
- Connects to Chrome via CDP WebSocket
- Captures browser console messages, errors, warnings
- Monitors network requests/responses
- Triggers automatic screenshots on errors and navigation
- Handles page crashes and reconnection

**MCP Server** (`mcp-server/app/mcp/route.ts` and `tools.ts`):
- Provides AI integration via Model Context Protocol
- Serves tools like `fix_my_app`, `execute_browser_action`, `get_mcp_capabilities`
- Implements dynamic MCP capability discovery (reads other MCPs' logs)
- Handles log search, browser automation, and debugging workflows

**TUI Interface** (`src/tui-interface-impl.tsx`):
- Terminal user interface built with Ink (React for CLIs)
- Shows real-time status of server, browser, MCP server
- Displays recent log entries in terminal

### Log Architecture

**Log Flow**:
1. User's dev server → stdout/stderr → captured by `dev-environment.ts`
2. Browser console/errors → CDP → captured by `cdp-monitor.ts`
3. Both streams → consolidated into single timestamped log file
4. Log file → stored in `~/.d3k/logs/dev3000-[project]-[timestamp].log`
5. MCP server → reads log file via SSE streaming → serves to UI and AI tools

**Log Rotation**: Keeps 10 most recent log files per project (managed in `dev-environment.ts`)

### Browser Automation

**Chrome Profile Management**:
- Each project gets unique profile directory (by default: `/tmp/dev3000-chrome-profile-[project]`)
- Preserves login state, cookies, extensions between sessions
- Can be customized via `--profile-dir` flag

**CDP Integration**:
- For local: Playwright launches Chrome with `--remote-debugging-port`
- For Docker/WSL2: Chrome runs on host, dev3000 connects via `host.docker.internal:9222`
- CDP URL passed via env var `DEV3000_CDP_URL` or auto-detected

**Screenshot System** (`src/screencast-manager.ts`):
- Automatic screenshots on: navigation, errors, timeouts, console errors
- Saved to `mcp-server/public/screenshots/[timestamp].jpg`
- Accessible via MCP server UI at http://localhost:3684/logs

### MCP (Model Context Protocol) Integration

**Dynamic Capability Discovery**:
- dev3000 can discover other running MCPs (chrome-devtools, nextjs-dev)
- Introspects MCP logs to extract available functions
- Caches capabilities for 5 minutes
- Suggests enhanced functions when relevant to current debugging context

**Core MCP Tools** (in `mcp-server/app/mcp/tools.ts`):
- `fix_my_app` - AI-powered log analysis with dynamic capability suggestions
- `execute_browser_action` - Browser automation (click, navigate, screenshot)
- `get_mcp_capabilities` - Inspect available MCP ecosystem
- `read_consolidated_logs` - Get logs with filtering
- `search_logs` - Regex search with context
- `get_browser_errors` - Extract errors by time period
- `discover_available_mcps` - Find running MCPs via process/port detection
- `get_shared_cdp_url` - Get CDP WebSocket URL for browser coordination

### Platform-Specific Support

**Docker/WSL2 Mode**:
- Required for Windows (CDP doesn't work natively on Windows)
- Chrome runs on Windows host with GPU acceleration
- dev3000 runs in Linux container with proper Unix tools
- `Makefile` provides commands: `make dev-up`, `make dev-down`, `make dev-logs`
- `docker-compose.yml` mounts user's project via `/mnt/c/...` → `/app`

**Native Mode** (macOS/Linux):
- dev3000 launches Chrome directly via Playwright
- All processes run on host machine

## Testing

**Local Testing**:
```bash
pnpm run canary  # Build, package, and install globally for testing
```

**Test Suite**:
- `pnpm test` - Unit tests with Vitest
- `pnpm run test-clean-install` - Test clean installations in isolated environments
- `pnpm run test-release` - Comprehensive release tests (build, pack, MCP tests)

## Common Development Tasks

**Adding a new MCP tool**:
1. Add tool definition to `mcp-server/app/mcp/tools.ts` in `ALL_TOOLS` array
2. Implement tool handler in the same file
3. Update TypeScript types for tool parameters
4. Test via Claude Code: `"use the [tool name] tool"`

**Modifying log format**:
1. Update parsers in `src/services/parsers/` (e.g., `StandardLogParser`, `NextJsErrorDetector`)
2. Ensure `OutputProcessor` in same directory handles new format
3. Update log streaming in `mcp-server/app/api/logs/stream/route.ts`

**Changing browser automation**:
1. Modify CDP interactions in `src/cdp-monitor.ts`
2. For screenshot logic, edit `src/screencast-manager.ts`
3. For browser actions, edit `execute_browser_action` tool in `mcp-server/app/mcp/tools.ts`

**Build process**:
- CLI is built via TypeScript: `pnpm build` → compiles `src/` to `dist/`
- MCP server is built as Next.js app: Next.js builds `mcp-server/` during package publish
- Both are bundled together in npm package (see `files` in `package.json`)

## Important Patterns

**Logging**:
- Use structured logger from `src/utils/logger.ts`
- Tag logs with source: `[D3K]` (dev3000), `[SERVER]` (user's server), `[BROWSER]` (browser console)
- Use `formatTimestamp()` from `src/utils/timestamp.ts` for consistent timestamps

**Error Handling**:
- All CDP errors should gracefully reconnect (see `cdp-monitor.ts`)
- Process crashes should be logged with full context before exit
- Browser crashes should trigger screenshots before cleanup

**Port Management**:
- User's app port: default 3000, configurable via `--port`
- MCP server port: default 3684, configurable via `--mcp-port`
- Chrome CDP port: 9222 (standard), configurable via env vars
- All ports have conflict detection and auto-increment fallback

## Configuration Files

**User-Facing**:
- `.dev3000.json` (optional) - Per-project config (port, script, browser path, etc.)
- Command-line flags override config file values

**Internal**:
- `biome.json` - Linting and formatting (Biome instead of ESLint/Prettier)
- `tsconfig.json` - TypeScript config (strict mode enabled)
- `pnpm-workspace.yaml` - Workspace packages and catalog dependencies

## Docker Development

**Makefile Workflow** (for Windows/WSL2):
1. `make dev-up` - Starts Chrome on host, launches dev3000 container
2. Automatically configures CDP URL via `host.docker.internal`
3. Mounts project from `/mnt/c/...` into `/app` inside container
4. `node_modules` and `.next` stay in container (performance optimization)

**Key Files**:
- `docker/docker-compose.yml` - Container definition, volume mounts
- `docker/Dockerfile` - Node.js environment with Chrome dependencies
- `Makefile` - Cross-platform Chrome CDP management (WSL/Linux/macOS)

## Memories

- number 3 sounds pretty reliable, number 2 sounds second best and those are better than the other two I think

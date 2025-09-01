# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Build the project:
```bash
npm run build
# or with tsx for development
npm run dev
```

The default server command in CLI is `pnpm dev` but can be overridden with `--server-command`.

## Architecture Overview

This is a TypeScript npm package that provides AI-powered development tools for Next.js projects. The architecture consists of:

**CLI Entry Point** (`src/cli.ts`):
- Uses Commander.js for CLI interface
- Two main commands: `start` (dev environment) and `setup` (project setup)
- Default command is `start` if no subcommand provided

**Core Components**:

1. **Project Setup** (`src/setup.ts`):
   - Installs MCP (Model Context Protocol) API routes in Next.js app directory
   - Creates `app/api/mcp/[transport]/route.ts` with three tools: `read_consolidated_logs`, `search_logs`, `get_browser_errors`
   - Updates package.json with `dev:ai` script and dependencies (`mcp-handler`, `zod`)
   - Manages .gitignore entries for `ai-dev-tools/` directory

2. **Development Environment** (`src/dev-environment.ts`):
   - Orchestrates any dev server + browser monitoring via Playwright
   - Works with any web framework (Next.js, Vite, etc.)
   - Checks port availability before starting (defaults: 3000 for app, 3684 for MCP server)
   - If ports are in use, displays process IDs and kill command instead of auto-killing
   - Uses persistent Chrome profile and captures unified logs
   - Monitors console logs, network requests, page errors, navigation events
   - Takes automatic screenshots on errors and route changes

**MCP Integration**: The generated route provides AI assistants with tools to analyze development logs in real-time. Tools can read recent logs, search with regex patterns, and extract browser errors from specified time periods.

**Log Format**: Unified timestamps with source prefixes:
```
[2025-08-30T12:54:03.033Z] [SERVER] Ready on http://localhost:3000
[2025-08-30T12:54:03.435Z] [BROWSER] [CONSOLE LOG] App initialized
```

**Target Use Case**: Designed for Next.js 13+ projects with app directory structure. The tool creates isolated browser profiles and consolidated logging to enable AI-assisted debugging and development workflow analysis.
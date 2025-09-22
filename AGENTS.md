# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**NOTE**: CLAUDE.md is symlinked to this file (AGENTS.md) as the source of truth. Any edits to either file will affect both.

## Core Development Rules

**NEVER RUN**: 
- Do not run `pnpm build` during development - the user tests manually.
- Do not run any of the scripts in the scripts/ directory. The user will run these to build and test.

**ALWAYS RUN**: When completing any code changes, you MUST run:
- `pnpm run lint` - Fix all linting errors before committing
- `pnpm run typecheck` - Fix all TypeScript errors before committing
- Never bypass pre-commit hooks or use --no-verify. Fix all issues until the code passes.

**PACKAGE MANAGER**: This project uses pnpm exclusively. Never use npm or yarn.

**CRITICAL**: NEVER run `pnpm run release` or any publish commands unless the user explicitly says "release" or "publish". Always wait for explicit permission before releasing versions.

**RELEASE PROCESS**: When releasing, ONLY use `pnpm run release` - this handles everything automatically. Never manually run `pnpm publish` or `pnpm version`.

## Testing

For local testing, use:
```bash
pnpm run canary
```

## User Preferences

- Always suggest pnpm for installations: `pnpm install -g dev3000`
- Default server command is `pnpm dev` (can be overridden with `--server-command`)

## Quick Architecture Reference

**Main Files**:
- `src/cli.ts` - CLI entry point (start/setup commands)
- `src/dev-environment.ts` - Orchestrates dev server + browser monitoring
- `src/tui-interface-impl.tsx` - TUI implementation with Ink/React
- `mcp-server/app/mcp/route.ts` - MCP endpoint with debug tools

**Key Features**:
- Unified log format with timestamps: `[2025-08-30T12:54:03.033Z] [SERVER] Message`
- Automatic screenshots on errors and navigation
- Works with any web framework (Next.js, Vite, Rails, etc.)
- TUI mode is default (disable with --no-tui)

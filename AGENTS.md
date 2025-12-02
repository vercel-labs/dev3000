# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**NOTE**: CLAUDE.md is symlinked to this file (AGENTS.md) as the source of truth. Any edits to either file will affect both.

## Core Development Rules

**NEVER RUN**: 
- Do not run `pnpm build` or `pnpm dev` during development - the user tests manually.


**ALWAYS RUN**: When completing any code changes, you MUST run:
- `pnpm run lint` - Fix all linting errors before committing
- `pnpm run typecheck` - Fix all TypeScript errors before committing
- Never bypass pre-commit hooks or use --no-verify. Fix all issues until the code passes.

**PACKAGE MANAGER**: This project uses pnpm exclusively. Never use npm or yarn.

**TURBOPACK**: NEVER disable turbopack in favor of webpack. This project uses turbopack exclusively for Next.js builds. Do not switch to webpack under any circumstances.

## Testing

For local testing, use:
```bash
pnpm run canary
```

## Quick Architecture Reference

**Main Files**:
- `src/cli.ts` - CLI entry point (start/setup commands)
- `src/dev-environment.ts` - Orchestrates dev server + browser monitoring
- `src/tui-interface-impl.tsx` - TUI implementation with Ink/React
- `mcp-server/app/mcp/route.ts` - MCP endpoint with debug tools

**Key Features**:
- Automatic screenshots on errors and navigation
- Works with any web framework (Next.js, Vite, Rails, etc.)

## Memories

- number 3 sounds pretty reliable, number 2 sounds second best and those are better than the other two I think

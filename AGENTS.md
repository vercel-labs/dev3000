# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**NOTE**: CLAUDE.md is symlinked to this file (AGENTS.md) as the source of truth. Any edits to either file will affect both.

## Core Development Rules

**NEVER RUN**:
- Do not run `bun run build` or `bun run dev` during development - the user tests manually.
- Do not run `./scripts/publish.sh` - the user runs this manually (requires npm auth).

**RELEASING**: When the user asks to release:
- You CAN run `./scripts/release.sh` - this builds, tests, bumps version, and creates the git tag
- After release.sh completes, tell the user to run `./scripts/publish.sh` themselves


**ALWAYS RUN**: When completing any code changes, you MUST run:
- `bun run lint` - Fix all linting errors before committing
- `bun run typecheck` - Fix all TypeScript errors before committing
- Never bypass pre-commit hooks or use --no-verify. Fix all issues until the code passes.

**AFTER COMMITTING**: When you push to main, Vercel auto-deploys. Monitor the deployment:
1. First, get the latest deployment URL: `vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | head -10`
2. Wait for deployment to complete (status changes from "Building" to "Ready")
3. Monitor runtime logs with the deployment URL: `vercel logs <deployment-url>.vercel.sh --scope team_nLlpyC6REAqxydlFKbrMDlud`
   - Example: `vercel logs dev3000-6tynruehj.vercel.sh --scope team_nLlpyC6REAqxydlFKbrMDlud`
   - NOTE: `d3k-mcp.vercel.app` doesn't work for `vercel logs` - you need the specific deployment URL
4. Once deployed, proceed with testing the changes - don't wait for user confirmation

**PACKAGE MANAGER**: This project uses bun exclusively. Do not use npm, pnpm, or yarn.

**TURBOPACK**: NEVER disable turbopack in favor of webpack. This project uses turbopack exclusively for Next.js builds. Do not switch to webpack under any circumstances.

## Testing

**BUILD CANARY AFTER d3k CHANGES**: When making changes to the d3k CLI or TUI (anything in `src/`), you MUST run `bun run canary` after committing so the user can test. This is the only way to test d3k changes locally. However, you do NOT need to rebuild canary for:
- Changes to `www/` (website) - those are tested via `bun run dev` in www/
- Changes to `mcp-server/` only - those are tested via the deployed MCP server

For local testing, use:
```bash
bun run canary
```

To test the d3k-in-the-cloud workflow:
- Use d3k MCP browser automation (NOT curl/API calls)
- Navigate to `http://localhost:3000/workflows/new?type=cloud-fix&team=team_aMS4jZUlMooxyr9VgMKJf9uT&project=prj_0ITI5UHrH4Kp92G5OLEMrlgVX08p`
- Start monitoring production logs BEFORE triggering: `vercel logs <deployment> --scope team_nLlpyC6REAqxydlFKbrMDlud`
- The local dev server must be running for the UI to work

## Quick Architecture Reference

**Main Files**:
- `src/cli.ts` - CLI entry point (start/setup commands)
- `src/dev-environment.ts` - Orchestrates dev server + browser monitoring
- `src/tui-interface.ts` - TUI loader (switches between implementations)
- `src/tui-interface-opentui.ts` - TUI implementation with OpenTUI (mouse scroll support)
- `src/tui-interface-impl.tsx` - Legacy TUI implementation with Ink/React
- `mcp-server/app/mcp/route.ts` - MCP endpoint with debug tools

**Key Features**:
- Automatic screenshots on errors and navigation
- Works with any web framework (Next.js, Vite, Rails, etc.)

## Sandbox/Cloud Environment Constraints

**CRITICAL: No `lsof` in Vercel Sandbox or Docker containers!**

When writing code that runs in:
- Vercel Sandbox (cloud workflows)
- Docker containers
- Any constrained environment

**NEVER use `lsof`** - it doesn't exist in these environments and will crash with `spawn lsof ENOENT`.

Instead, use the `isInSandbox()` helper function (defined in `src/dev-environment.ts` and `mcp-server/app/mcp/tools.ts`) to detect sandbox environments and skip lsof-based operations:

```typescript
function isInSandbox(): boolean {
  return (
    process.env.VERCEL_SANDBOX === "1" ||
    process.env.VERCEL === "1" ||
    existsSync("/.dockerenv") ||
    existsSync("/run/.containerenv")
  )
}
```

Other unavailable commands in sandbox: `netstat`, `ss` (sometimes), most system utilities.

## Memories

- number 3 sounds pretty reliable, number 2 sounds second best and those are better than the other two I think

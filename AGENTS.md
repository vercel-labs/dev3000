# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**NOTE**: CLAUDE.md is symlinked to this file (AGENTS.md) as the source of truth. Any edits to either file will affect both.

## Standalone AI App + d3k (Required Runtime)

When working from a standalone AI app (Codex.app, Claude Code app, etc.) in this repo, use `d3k` as the default runtime so the agent gets server logs + CDP browser data + screenshots from one session.

### Why this is better than running `npm/bun dev` directly

- `d3k` captures both server and browser telemetry in one timeline (`d3k.log`), which prevents partial debugging context.
- `d3k` exposes a stable CDP session (`d3k cdp-port`) so the agent can drive the same real browser instance users see.
- `d3k` records screenshots and interaction context automatically, making regressions easier to verify and replay.
- Running raw `npm dev`/`bun dev` skips this unified context and leads to weaker diagnoses.

1. Start d3k (headed browser, no split-agent prompt):
   ```bash
   d3k --no-agent --no-tui -t
   ```
2. Keep d3k running while making/fixing changes. Do not run `bun run dev` directly.
3. Use d3k diagnostics as first-line debugging:
   ```bash
   d3k errors --context
   d3k logs -n 200
   d3k logs --type browser
   d3k logs --type server
   ```
4. Use the same monitored browser session via CDP:
   ```bash
   CDP_PORT="$(d3k cdp-port)"
   d3k agent-browser --cdp "$CDP_PORT" open http://localhost:3000
   d3k agent-browser --cdp "$CDP_PORT" snapshot -i
   d3k agent-browser --cdp "$CDP_PORT" click @e2
   d3k agent-browser --cdp "$CDP_PORT" screenshot /tmp/d3k-current.png
   ```
5. Primary artifacts for Codex context:
   - `~/.d3k/{project}/d3k.log`
   - `~/.d3k/{project}/logs/`
   - `~/.d3k/{project}/screenshots/`
   - `~/.d3k/{project}/session.json`

Use `--servers-only` or `--headless` only if the user explicitly asks.

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
   - NOTE: `d3k.vercel.app` doesn't work for `vercel logs` - you need the specific deployment URL
4. Once deployed, proceed with testing the changes - don't wait for user confirmation

**PACKAGE MANAGER**: This project uses bun exclusively. Do not use npm, pnpm, or yarn.

**TURBOPACK**: NEVER disable turbopack in favor of webpack. This project uses turbopack exclusively for Next.js builds. Do not switch to webpack under any circumstances.

## Testing

**BUILD CANARY AFTER d3k CHANGES**: When making changes to the d3k CLI or TUI (anything in `src/`), you MUST run `bun run canary` after committing so the user can test. This is the only way to test d3k changes locally. However, you do NOT need to rebuild canary for:
- Changes to `www/` (website) - those are tested via `bun run dev` in www/

For local testing, use:
```bash
bun run canary
```

To test the d3k-in-the-cloud workflow:
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

Instead, use the `isInSandbox()` helper function (defined in `src/dev-environment.ts`) to detect sandbox environments and skip lsof-based operations:

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

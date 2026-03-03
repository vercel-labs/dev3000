---
name: d3k
description: Bootstrap d3k in standalone AI apps (Codex, Cursor, Claude Code): detect/install dev3000, start d3k as the runtime, and use unified logs plus CDP browser control instead of running npm/bun dev directly.
---

# d3k Standalone Bootstrap

Use this skill when working in a standalone AI app and you need reliable local web debugging with browser + server context.

## Why d3k-first

- `d3k` captures server logs, browser console, network events, and screenshots in one timeline.
- `d3k` exposes a stable CDP endpoint so the agent can control the same browser session being monitored.
- Running `npm run dev` or `bun run dev` directly omits this unified telemetry and usually leads to weaker diagnoses.

## Bootstrap Workflow

1. Confirm whether `d3k` is installed:
```bash
command -v d3k >/dev/null && d3k --version
```

2. If `d3k` is missing, install dev3000 globally (prefer Bun):
```bash
bun install -g dev3000
```
Fallback if Bun is unavailable:
```bash
npm install -g dev3000
```

3. Start d3k as the runtime (preferred default in agent shells):
```bash
d3k --no-agent --no-tui -t
```

4. Keep d3k running while editing code. Do not start a second dev server with `npm/bun dev`.

## Debugging Commands

Use these first before ad-hoc log scraping:

```bash
d3k errors --context
d3k logs -n 200
d3k logs --type browser
d3k logs --type server
```

## CDP Browser Control

Use the already-monitored browser session instead of launching a separate automation browser.

```bash
CDP_PORT="$(d3k cdp-port)"
d3k agent-browser --cdp "$CDP_PORT" open http://localhost:3000
d3k agent-browser --cdp "$CDP_PORT" snapshot -i
d3k agent-browser --cdp "$CDP_PORT" click @e2
d3k agent-browser --cdp "$CDP_PORT" screenshot /tmp/d3k-current.png
```

## Artifacts to Read

- `~/.d3k/{project}/d3k.log`
- `~/.d3k/{project}/logs/`
- `~/.d3k/{project}/screenshots/`
- `~/.d3k/{project}/session.json`

## Operating Rules

- Prefer headed mode for interactive debugging.
- Use `--headless` only for CI or when explicitly requested.
- Use `--servers-only` only when browser monitoring is intentionally disabled.

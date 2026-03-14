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

## Browser Tool Choice

Use the browser tool that matches the task instead of treating them as interchangeable:

- `agent-browser`
  - Default choice.
  - Best for generic web apps and for driving the exact headed browser session that d3k is already monitoring via CDP.
  - Use it when you need `snapshot`, ref-based `click`, `fill`, or to reproduce what the user sees in the monitored tab.
- `next-browser`
  - Next.js-specific tool.
  - Best for React/Next introspection: `tree`, `errors`, `logs`, `routes`, `project`, PPR inspection, and related Next dev-server signals.
  - It is not a drop-in replacement for `agent-browser`: no accessibility `snapshot`, no ref-based `click`, and no `fill`.
  - It launches its own daemon/browser flow and does not use `d3k cdp-port`.

Practical rule:

- Need to drive the same browser d3k is monitoring: use `agent-browser`.
- Need Next.js component tree or Next-specific diagnostics: use `next-browser`.

Examples:

```bash
# Same monitored browser session
CDP_PORT="$(d3k cdp-port)"
d3k agent-browser --cdp "$CDP_PORT" snapshot -i
d3k agent-browser --cdp "$CDP_PORT" click @e2

# Next.js-specific inspection
d3k next-browser open http://localhost:3000
d3k next-browser tree
d3k next-browser errors
d3k next-browser logs
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

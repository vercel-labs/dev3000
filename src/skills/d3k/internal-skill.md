---
name: "d3k"
description: "Use when the user asks to use d3k, run/dev/test/debug a web project with d3k, or reproduce a browser issue. Own the runtime: reuse or background-start d3k non-interactively, wait for readiness, use its project-stable managed Chrome profile, and inspect unified browser/server evidence."
---

# d3k Agent Runtime

d3k is the local web runtime for this task. It starts the dev server behind a stable Portless URL, owns a project-stable Chrome profile, and records server logs, browser console output, network activity, interactions, and screenshots in one timeline.

When this skill triggers, operate d3k. Do not merely tell the user how to run it.

## Interpret the Request

- "Let me test/dev my project with d3k": prepare the runtime and headed browser, confirm it is ready, then hand control to the user. Wait for them to reproduce the issue before inspecting evidence.
- "Test/debug/fix this with d3k": prepare the runtime, then drive the managed browser and investigate autonomously.
- If ambiguous, start the runtime and browser first. That action is safe and useful for either path.

## Start or Reuse d3k

Run from the project root.

1. Check for an existing project runtime:

```bash
d3k status --json
```

If it reports `"running": true`, reuse it. Do not start a second dev server or browser.

2. If d3k is not installed, install it:

```bash
bun install -g dev3000
```

Use `npm install -g dev3000` only when Bun is unavailable.

3. Start d3k with the agent's shell/process tool as a retained background or yielded session:

```bash
d3k --no-agent --no-tui -t
```

Do not wait for this long-running command to exit. Keep its process/session handle so you can monitor or stop it later. Prefer the execution tool's background/session support over shelling with `&`.

If the target URL is already known, pass it so the managed browser opens there:

```bash
d3k --no-agent --no-tui -t --app-url "<url>"
```

Let d3k auto-detect the package manager, dev command, and port. Add `--command`, `--script`, or `--port` only when detection is wrong or the user specified them.

4. Poll until the runtime is ready:

```bash
d3k status --json
```

A successful status response is the readiness boundary. Prefer the reported Portless `appUrl`; the underlying app port may change between runs. If startup fails, inspect the retained process output and `d3k logs --type server`; do not launch a separate dev server.

## User-Driven Testing

When the user says "let me test":

1. Confirm the status response includes the app URL and `"browserConnected": true`.
2. Tell the user the monitored browser is ready.
3. Keep the d3k process running and wait for the user to reproduce the behavior.
4. When they report that it happened, begin with:

```bash
d3k errors --context
d3k logs -n 200
```

Do not replace the headed browser with automation while the user is testing.

## Agent-Driven Testing

Drive the exact browser d3k is monitoring:

```bash
d3k agent-browser snapshot -i
d3k agent-browser click @e2
d3k agent-browser fill @e3 "text"
d3k errors --context
```

Use `--require-d3k-browser` when opening a URL so failure cannot silently create another browser:

```bash
d3k agent-browser --require-d3k-browser open "<url>"
```

After every reproduction or code change, replay the relevant interaction and check `d3k errors --context` again.

## Evidence Commands

Prefer these over ad-hoc log scraping:

```bash
d3k status --json
d3k errors --context
d3k logs -n 200
d3k logs --type browser
d3k logs --type server
```

Artifacts live under `~/.d3k/<project>/`, including `session.json`, logs, screenshots, and the Chrome profile.

## Browser and Auth Safety

d3k must own browser startup by default. Its per-project Chrome profile preserves login state, cookies, and local storage.

For Google OAuth, Supabase auth, and other auth-sensitive flows, never substitute raw Chrome, Playwright, a browser MCP session, manual CDP attachment, or `agent-browser --profile`. Those paths use a different browser/profile and can trigger "This browser or app may not be secure."

If the managed browser is unavailable, stop or interrupt the retained d3k process and restart d3k cleanly. Do not work around it by creating another browser.

Use `--headless` only for CI or when explicitly requested. Use `--servers-only` only when browser monitoring is intentionally unwanted.

## Operating Rules

- Do not run `npm run dev`, `bun run dev`, or another dev server alongside d3k.
- Do not start a second d3k when `d3k status --json` reports an active one.
- Keep d3k alive across edits and retests.
- Preserve the project-stable Chrome profile unless the user explicitly asks for a fresh profile.
- Leave the runtime running when handing a headed browser to the user; stop it only when asked or when the task requires a clean restart.
- Portless routing is the default. Use `--no-portless` or `PORTLESS=0` only when direct localhost routing is explicitly required.

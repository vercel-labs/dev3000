---
name: "d3k"
description: "Bootstrap d3k in standalone AI apps (Codex, Cursor, Claude Code): detect/install dev3000, start d3k as the runtime, and use unified logs plus d3k-owned browser/session control instead of running npm/bun dev directly."
---

# d3k Standalone Bootstrap

Use this skill when working in a standalone AI app and you need reliable local web debugging with browser + server context.

## Why d3k-first

- `d3k` captures server logs, browser console, network events, and screenshots in one timeline.
- `d3k` owns the browser session so the agent can control the same browser being monitored.
- Running `npm run dev` or `bun run dev` directly omits this unified telemetry and usually leads to weaker diagnoses.

## Auth-Sensitive Browser Rule

For Google OAuth, Supabase auth, and any other auth-sensitive debugging, d3k must own browser startup. Start d3k normally so it launches the app and browser together, including `--app-url` when the target URL is known.

Do not use `d3k agent-browser --profile ... --headed open ...`, raw Chrome, Playwright, browser MCP sessions, manual CDP attachment, or any other separate automation browser for auth debugging unless the user explicitly asks for that path. Agent-browser-created/custom Chrome profiles can be rejected by Google with `This browser or app may not be secure`.

After d3k has launched the browser, use the safe managed-browser path:
```bash
d3k agent-browser --require-d3k-browser open "<url>"
d3k agent-browser snapshot -i
d3k agent-browser click @e1
d3k errors --context
```

If this fails because no d3k-managed browser exists, restart d3k cleanly with its normal browser-owning flow. Do not fall back to creating a new agent-browser Chrome for auth.

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

3. Start d3k as the runtime and let d3k own browser startup. When the app command, port, and target URL are known, use the normal app-debugging shape:
```bash
d3k --no-agent --command "<dev command>" --port <port> --startup-timeout <seconds> --no-tui --app-url "<url>"
```

   For a repo-default shell with no target URL yet:
```bash
d3k --no-agent --no-tui -t
```

4. Keep d3k running while editing code. Do not start a second dev server with `npm/bun dev`.

5. Drive the page through d3k's active browser session:
```bash
d3k agent-browser snapshot -i
d3k agent-browser click @e1
d3k errors --context
```

## Required Browser/Session Default

When a user asks to start or debug an app with d3k, prefer d3k's normal browser-owning flow, including `--app-url` when a target URL is known.

Do not launch a separate raw Chrome, Playwright browser, browser MCP session, or manually attach to CDP unless the user explicitly asks for that path. Separate automation-only browser profiles can break OAuth flows, especially Google sign-in with `This browser or app may not be secure`.

After d3k is running, drive the page through `d3k agent-browser ...` commands so interactions target d3k's active browser session.

If profile or daemon state seems stale, first run:
```bash
d3k agent-browser close --all
```

Then restart d3k cleanly with the normal browser-owning flow.

For a normal app-debugging session, use:
```bash
d3k --no-agent --command "<dev command>" --port <port> --startup-timeout <seconds> --no-tui --app-url "<url>"
d3k agent-browser --require-d3k-browser open "<url>"
d3k agent-browser snapshot -i
d3k agent-browser click @e1
d3k errors --context
```

## Non-Auth Fresh Browser/Profile Startup

Use this special-case workflow only for non-auth debugging when the user explicitly asks Codex to start d3k with a fresh browser/profile. Do not use this workflow for Google OAuth, Supabase auth, or any sign-in flow that may reject automation browsers. The default app-debugging workflow is to let d3k own browser startup and then interact through `d3k agent-browser`.

1. Close any stale `agent-browser` daemon before launching with `--profile`. Otherwise `agent-browser` will reuse the existing daemon and print `--profile ignored`.
   ```bash
   d3k agent-browser close --all
   ```

2. Start the app through d3k in `servers-only` mode and keep that command running. In Codex, this is more reliable than asking d3k to launch the browser itself when a fresh profile is required.
   ```bash
   d3k --no-agent --no-skills --servers-only --command "npm run dev -- -H 127.0.0.1 -p 3000" --port 3000 --startup-timeout 90 --no-tui
   ```

   Adjust the package-manager command and port for the project. Prefer `--command` over `--script` when passing framework flags. For npm scripts, put flags after `--`; otherwise tools like Next.js can interpret the port as a project directory.

3. Verify the server before opening more browser windows:
   ```bash
   curl -I http://127.0.0.1:3000
   ```

4. Open the fresh profile as a separate browser step:
   ```bash
   d3k agent-browser --allow-new-browser --profile /tmp/d3k-fresh-profile --headed open http://127.0.0.1:3000
   ```

5. Sanity-check the opened page:
   ```bash
   d3k agent-browser get title
   d3k agent-browser snapshot -i
   d3k errors
   ```

Practical rules:

- Prefer `127.0.0.1` for this workflow. If `localhost` hangs or flips between IPv4/IPv6 behavior, do not keep retrying browser launches.
- If `curl -I` hangs, the server is wedged even if the port appears occupied; restart the d3k server process before opening a browser.
- In `servers-only` mode there is no d3k-managed browser. Use `--allow-new-browser` only for the explicit non-auth fresh-profile open step; do not use `d3k cdp-port`.
- In sandboxed agent environments, rerun local-network checks and `agent-browser` opens outside the sandbox when sandbox networking blocks access to `127.0.0.1`.

## Debugging Commands

Use these first before ad-hoc log scraping:

```bash
d3k errors --context
d3k logs -n 200
d3k logs --type browser
d3k logs --type server
```

## Browser Interaction

Use the already-monitored d3k browser session instead of launching a separate automation browser.

```bash
d3k agent-browser --require-d3k-browser open http://localhost:3000
d3k agent-browser snapshot -i
d3k agent-browser click @e2
d3k agent-browser screenshot /tmp/d3k-current.png
```

`d3k agent-browser` auto-connects to the active d3k session's browser. `--require-d3k-browser` fails instead of creating a new browser when no d3k-managed browser exists. Manual CDP attachment, `d3k agent-browser connect <port>`, and `--allow-new-browser` are explicit opt-in paths for targeting or creating a different browser, not the default.

## Browser Tool Choice

Use the browser tool that matches the task instead of treating them as interchangeable:

- `agent-browser`
  - Default choice.
  - Best for generic web apps and for driving the exact headed browser session that d3k is already monitoring.
  - Use it when you need `snapshot`, ref-based `click`, `fill`, or to reproduce what the user sees in the monitored tab.
- `next-browser`
  - Next.js-specific tool.
  - Best for React/Next introspection: `tree`, `errors`, `logs`, `routes`, `project`, PPR inspection, and related Next dev-server signals.
  - It is not a drop-in replacement for `agent-browser`: no accessibility `snapshot`, no ref-based `click`, and no `fill`.
  - It launches its own daemon/browser flow and does not use d3k's active browser session.

Practical rule:

- Need to drive the same browser d3k is monitoring: use `agent-browser`.
- Need Next.js component tree or Next-specific diagnostics: use `next-browser`.

Examples:

```bash
# Same monitored browser session
d3k agent-browser snapshot -i
d3k agent-browser click @e2

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
- Use `--servers-only` only when browser monitoring is intentionally disabled, and not for auth-sensitive debugging.

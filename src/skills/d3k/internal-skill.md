---
name: "d3k"
description: "d3k assistant for debugging web apps"
---

# d3k Commands

d3k captures browser and server logs in a unified log file. Use these commands:

## Viewing Errors and Logs

```bash
d3k errors              # Show recent errors (browser + server combined)
d3k errors --context    # Show errors + user actions that preceded them
d3k errors -n 20        # Show last 20 errors

d3k logs                # Show recent logs (browser + server combined)
d3k logs --type browser # Browser logs only
d3k logs --type server  # Server logs only
```

## Other Commands

```bash
d3k fix                 # Deep analysis of application errors
d3k fix --focus build   # Focus on build errors

d3k crawl               # Discover app URLs
d3k crawl --depth all   # Exhaustive crawl
```

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

## Browser Interaction

`d3k agent-browser` auto-connects to the active d3k-managed browser session:

```bash
d3k agent-browser --require-d3k-browser open http://localhost:3000/page
d3k agent-browser snapshot -i    # Get element refs (@e1, @e2)
d3k agent-browser click @e2
d3k agent-browser fill @e3 "text"
d3k agent-browser screenshot /tmp/shot.png
```

`--require-d3k-browser` fails instead of creating a new browser when no d3k-managed browser exists. To target a different browser, run `d3k agent-browser connect <port>` first only when explicitly requested.

## Non-Auth Fresh Browser/Profile Startup

Use this workflow only for non-auth debugging when the user asks Codex to start d3k with a fresh browser/profile. Do not use it for Google OAuth, Supabase auth, or any sign-in flow that may reject automation browsers.

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

## Browser Tool Choice

Use `agent-browser` for browser work.

Practical rule:

- Need to drive the same monitored browser session: use `agent-browser`.
- Examples:

```bash
d3k agent-browser snapshot -i
d3k agent-browser click @e2
```

To make d3k prefer one locally when it launches helper browser commands, use:

```bash
d3k --browser-tool agent-browser
```

## Fix Workflow

1. `d3k errors --context` - See errors and what triggered them
2. Fix the code
3. `d3k agent-browser --require-d3k-browser open <url>` then `d3k agent-browser click @e1` to replay
4. `d3k errors` - Verify fix worked

## Creating PRs with Before/After Screenshots

When creating a PR for visual changes, **always capture before/after screenshots** to show the impact:

1. **Before making changes**, screenshot the production site:
   ```bash
   d3k agent-browser --require-d3k-browser open https://production-url.com/affected-page
   d3k agent-browser screenshot /tmp/before.png
   ```

2. **After making changes**, screenshot localhost:
   ```bash
   d3k agent-browser --require-d3k-browser open http://localhost:3000/affected-page
   d3k agent-browser screenshot /tmp/after.png
   ```

3. **Or use the tooling API** to capture multiple routes at once:
   ```
   capture_before_after_screenshots(
     productionUrl: "https://myapp.vercel.app",
     routes: ["/", "/about", "/contact"]
   )
   ```

4. **Include in PR description** using markdown:
   ```markdown
   ### Visual Comparison
   | Route | Before | After |
   |-------|--------|-------|
   | `/` | ![Before](before.png) | ![After](after.png) |
   ```

   Upload screenshots by dragging them into the GitHub PR description.

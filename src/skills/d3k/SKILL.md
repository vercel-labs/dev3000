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

d3k find-component "nav"  # Find React component source
```

## Browser Interaction

First run `d3k cdp-port` to get the port number, then use it directly in all browser commands:

```bash
d3k cdp-port                                          # Returns e.g. 9222
d3k agent-browser --cdp 9222 open http://localhost:3000/page
d3k agent-browser --cdp 9222 snapshot -i    # Get element refs (@e1, @e2)
d3k agent-browser --cdp 9222 click @e2
d3k agent-browser --cdp 9222 fill @e3 "text"
d3k agent-browser --cdp 9222 screenshot /tmp/shot.png
```

## Browser Tool Choice

Use the browser tool that matches the task:

- `agent-browser`
  - Default choice.
  - Best for generic web apps and for driving the exact headed browser session d3k is already monitoring.
  - Use it when you need `snapshot`, ref-based `click`, `fill`, or to reproduce what the user sees in the monitored tab.
- `next-browser`
  - Next.js-specific tool.
  - Best for Next/React introspection: `tree`, `errors`, `logs`, `routes`, `project`, and related Next dev-server diagnostics.
  - It is not a drop-in replacement for `agent-browser`: no accessibility `snapshot`, no ref-based `click`, and no `fill`.
  - It runs its own daemon/browser flow and does not use `d3k cdp-port`.

Practical rule:

- Need to drive the same monitored browser session: use `agent-browser`.
- Need Next.js component-tree or Next-specific diagnostics: use `next-browser`.

Examples:

```bash
# Same monitored browser session
d3k agent-browser --cdp 9222 snapshot -i
d3k agent-browser --cdp 9222 click @e2

# Next.js-specific inspection
d3k next-browser open http://localhost:3000
d3k next-browser tree
d3k next-browser errors
d3k next-browser logs
```

To make d3k prefer one locally when it launches helper browser commands, use:

```bash
d3k --browser-tool agent-browser
d3k --browser-tool next-browser
```

## Fix Workflow

1. `d3k errors --context` - See errors and what triggered them
2. Fix the code
3. Run `d3k cdp-port` to get the port, then `d3k agent-browser --cdp <port> open <url>` then `click @e1` to replay
4. `d3k errors` - Verify fix worked

## Creating PRs with Before/After Screenshots

When creating a PR for visual changes, **always capture before/after screenshots** to show the impact:

1. **Before making changes**, screenshot the production site (run `d3k cdp-port` first to get the port):
   ```bash
   d3k agent-browser --cdp <port> open https://production-url.com/affected-page
   d3k agent-browser --cdp <port> screenshot /tmp/before.png
   ```

2. **After making changes**, screenshot localhost:
   ```bash
   d3k agent-browser --cdp <port> open http://localhost:3000/affected-page
   d3k agent-browser --cdp <port> screenshot /tmp/after.png
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

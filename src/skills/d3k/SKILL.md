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

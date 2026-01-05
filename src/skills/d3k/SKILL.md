---
description: d3k web development assistant. Use when working on web apps with d3k running. Primary tool is fix_my_app for diagnosing and fixing errors.
---

# d3k Development Assistant

## Primary Tool: fix_my_app

The main d3k MCP tool for debugging web apps. It analyzes:
- Server logs and build errors
- Browser console output
- Network request failures
- JavaScript exceptions

**Usage loop:**
```
while (errors exist) {
  1. Call fix_my_app → get prioritized errors
  2. Fix the highest-priority error
  3. Call fix_my_app again → verify fix worked
  4. Repeat until healthy
}
```

**Parameters:**
- `focusArea`: 'build', 'runtime', 'network', 'ui', 'performance', or 'all'
- `mode`: 'snapshot' (default), 'bisect', or 'monitor'
- `timeRangeMinutes`: How far back to analyze (default: 10)

## Other Available Tools

- **browser_action** - Click, navigate, scroll, type, screenshot, evaluate JS
- **get_web_vitals** - Core Web Vitals (LCP, CLS, INP)
- **get_layout_shifts** - CLS debugging

## If d3k Tools Aren't Available

d3k may not be running or connected. Start it in a separate terminal:
```
d3k
```

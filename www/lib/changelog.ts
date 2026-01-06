export type ReleaseType = "major" | "minor" | "patch"

export interface Release {
  version: string
  date: string
  type: ReleaseType
  highlights: string[]
}

// Changelog data structure - this will be updated by the release script
export const changelog: Release[] = [
  {
    version: "0.0.132",
    date: "2026-01-06",
    type: "minor",
    highlights: [
      "Update pnpm-lock.yaml",
      "Skip clean install tests when platform package not on npm",
      "Fix release tests to skip npm install when platform package not on npm",
      "Add Bun compilation, graceful shutdown, and OpenCode MCP support",
      "Add agent selection prompt as default startup behavior"
    ]
  },

  {
    version: "0.0.131",
    date: "2026-01-06",
    type: "minor",
    highlights: [
      "Switch CLI runtime from Node.js to Bun for better performance",
      "Add purple active pane border in tmux split-screen mode to show focus",
      "Fix Next.js server not being killed on exit (use PID-based cleanup)",
      "Fix MCP tools/list crash caused by JSON Schema vs Zod schema mismatch"
    ]
  },

  {
    version: "0.0.130",
    date: "2026-01-05",
    type: "minor",
    highlights: ["Add --with-agent flag for split-screen mode with tmux"]
  },

  {
    version: "0.0.129",
    date: "2026-01-05",
    type: "minor",
    highlights: [
      "Fix npm global install detection and Next.js version mismatch",
      "Add auto-install d3k skill for Claude Code",
      "Fix multiple d3k instances killing each other's Chrome browsers",
      "Fix Web Vitals parsing to handle both response formats",
      "Fix MCP response parsing for SSE format"
    ]
  },

  {
    version: "0.0.128",
    date: "2025-12-22",
    type: "patch",
    highlights: [
      "Use Chrome DevTools MCP performance trace for Web Vitals capture",
      "Fix Web Vitals capture to finalize LCP with user interaction",
      "Fix chrome-devtools MCP port mismatch by sorting session files by modification time",
      "Add CDP_URL environment variable support for MCP orchestration"
    ]
  },

  {
    version: "0.0.127",
    date: "2025-12-16",
    type: "minor",
    highlights: [
      "Reduce log noise by making CDP layout shift logs conditional on --debug flag",
      "Add GitHub PAT support for automatic PR creation in workflows",
      "Simplify workflow architecture (v2) with better progress streaming",
      "Fix CLS measurement with 1920x1080 viewport in headless mode",
      "Improve workflow report UI with coordinated screenshot players"
    ]
  },

  {
    version: "0.0.126",
    date: "2025-12-11",
    type: "minor",
    highlights: [
      "Remove nextjs-dev_browser_eval tool from MCP proxy whitelist",
      "Add withWorkflow wrapper to Next.js config",
      "Add /api/teams endpoint and use same-origin API for workflows",
      "Update WORKFLOW_TESTING_GUIDE with correct www project ID",
      "Refactor workflow into discrete steps with sandbox reconnection"
    ]
  },

  {
    version: "0.0.125",
    date: "2025-12-11",
    type: "patch",
    highlights: [
      "Replace catalog: references with actual versions in mcp-server",
      "Move workflows UI from mcp-server to www"
    ]
  },

  {
    version: "0.0.124",
    date: "2025-12-11",
    type: "patch",
    highlights: [
      "Fix Next.js port argument passing - remove -- separator",
      "Pass port argument to dev server when -p is specified",
      "Fix log file selector not showing previous logs",
      "Fix chrome-devtools-mcp CDP conflicts",
      "Replace hardcoded bypass token with env var reference in guide"
    ]
  },

  {
    version: "0.0.123",
    date: "2025-12-09",
    type: "minor",
    highlights: [
      "Fix Chrome version detection and MCP discovery in sandbox",
      "Fix undefined resultStr error in agent transcript building",
      "Trigger redeploy",
      "Improve agent analysis capture and report page UX",
      "Add git diff and d3k logs display to workflow report page"
    ]
  },

  {
    version: "0.0.122",
    date: "2025-12-09",
    type: "patch",
    highlights: [
      "Stop tracking auto-generated next-env.d.ts",
      "Use high ports in test-release.sh MCP startup test",
      "Fix test to actually use high port by setting PORT env var"
    ]
  },

  {
    version: "0.0.121",
    date: "2025-12-08",
    type: "patch",
    highlights: ["Use high ports (>4000) in release tests to avoid conflicts"]
  },

  {
    version: "0.0.120",
    date: "2025-12-08",
    type: "minor",
    highlights: [
      "Fix orphaned Playwright/Chrome processes on startup",
      "Add debug logging for agent text output",
      "Fix blob overwrite error and update testing guide",
      "Add agentic AI with d3k sandbox tools for CLS fixing",
      "Save workflow reports incrementally to blob storage"
    ]
  },

  {
    version: "0.0.119",
    date: "2025-12-06",
    type: "minor",
    highlights: [
      "Remove Next.js canary workaround from test-logs-api.ts",
      "Switch from Next.js canary to latest (16.0.7)",
      "Add server/instrumentation.js for Vercel build compatibility",
      "Fix Chrome launch issues and improve release test reliability",
      "Update pnpm.overrides to Next.js 16.1.0-canary.15"
    ]
  },

  {
    version: "0.0.118",
    date: "2025-12-05",
    type: "minor",
    highlights: [
      "Update Next.js auto-generated type reference",
      "Remove network-idle screenshot spam",
      "Update AGENTS.md with correct vercel logs instructions",
      "Fix Step 1 timeout by ensuring clsData always truthy from Step 0",
      "Add CORS headers to /api/workflows endpoint"
    ]
  },

  {
    version: "0.0.117",
    date: "2025-12-05",
    type: "patch",
    highlights: ["Fix server detection in sandbox environments"]
  },

  {
    version: "0.0.116",
    date: "2025-12-05",
    type: "minor",
    highlights: [
      "Add Vercel MCP tools section to WORKFLOW_TESTING_GUIDE",
      "Rewrite tool descriptions to enforce diagnose-fix-verify loop",
      "Capture d3k stdout/stderr to d3k-startup.log and dump logs on CDP failure",
      "Add always-on diagnostic logging to CDPMonitor for sandbox debugging",
      "Add Node.js spawn() diagnostic test for Chrome in sandbox"
    ]
  },

  {
    version: "0.0.115",
    date: "2025-12-05",
    type: "patch",
    highlights: [
      "Fix tui-interface-impl test after upstream refactor",
      "Update next-env.d.ts types import path",
      "Simplify",
      "Always write session info after CDP monitoring for sandbox support",
      "Prevent flashing"
    ]
  },

  {
    version: "0.0.114",
    date: "2025-12-04",
    type: "patch",
    highlights: [
      "Remove unused next dependency from root package.json",
      "Fix process cleanup to kill entire process group on shutdown"
    ]
  },

  {
    version: "0.0.113",
    date: "2025-12-04",
    type: "minor",
    highlights: [
      "Update Next.js type definitions after build",
      "Add --headless flag for Chrome in serverless/CI environments",
      "Add screenshot columns to workflows table and fix SSE parsing",
      "Fix sandbox MCP response parsing and add log dumping",
      "Fix WORKFLOW_TESTING_GUIDE.md to use correct mcp-server production team"
    ]
  },

  {
    version: "0.0.112",
    date: "2025-12-02",
    type: "minor",
    highlights: [
      "TUI improvements and MCP tool whitelist fixes for v0.0.112",
      "Upgrade workflow to 4.0.1-beta.23 with upstream @workflow/errors fix",
      "Trigger Vercel rebuild with workflow@4.0.1-beta.22 and @workflow/errors",
      "Update pnpm-lock.yaml for @workflow/errors dependency",
      "Add @workflow/errors as direct dependency for Vercel builds"
    ]
  },

  {
    version: "0.0.111",
    date: "2025-12-02",
    type: "minor",
    highlights: [
      "Fix workflow@4.0.1-beta.22 build by adding pnpm override",
      "Upgrade workflow to 4.0.1-beta.22 with @workflow/errors dependency",
      "Emphasize CLI-only verification and add MCP tool whitelist",
      "Update WORKFLOW_TESTING_GUIDE to use d3k MCP tools instead of curl",
      "Revert workflow upgrade due to peer dependency issue"
    ]
  },

  {
    version: "0.0.110",
    date: "2025-12-01",
    type: "patch",
    highlights: [
      "Update Next.js type references after route cleanup",
      "Remove Phase 1 POC artifacts",
      "Clean up unused artifacts and improve workflow testing",
      "Fix React duplicate key warnings on workflows page",
      "Trigger deployment"
    ]
  },

  {
    version: "0.0.109",
    date: "2025-11-18",
    type: "patch",
    highlights: [
      "Fix lsof port checking to only skip in sandbox environments",
      "Disable lsof port checking entirely to fix sandbox crashes",
      "Fix lsof ENOENT crash by checking command existence first",
      "Fix TypeScript type safety in cloud workflow start",
      ".gitignore updates"
    ]
  },

  {
    version: "0.0.108",
    date: "2025-11-18",
    type: "patch",
    highlights: [
      "Ignore TypeScript build info file",
      "Update Next.js build artifact (next-env.d.ts)",
      "Fix browser automation and multi-instance support",
      "Fix d3k command in cloud workflow Step 0 - remove invalid 'start' subcommand",
      "Fix d3k startup - use correct --no-tui flag"
    ]
  },

  {
    version: "0.0.108",
    date: "2025-11-07",
    type: "minor",
    highlights: [
      "**MCP Config Control**: Use `--disable-mcp-configs`, `DEV3000_DISABLE_MCP_CONFIGS`, or `$XDG_CONFIG_HOME/dev3000/config.json` (falls back to `~/.config/dev3000/config.json`) to skip writing specific MCP config files (resolves [#58](https://github.com/vercel-labs/dev3000/issues/58))",
      "**User Config Defaults**: `$XDG_CONFIG_HOME/dev3000/config.json` (or `~/.config/dev3000/config.json`) now stores persistent CLI defaults like MCP config suppression"
    ]
  },

  {
    version: "0.0.107",
    date: "2025-10-28",
    type: "patch",
    highlights: [
      "Fix module resolution for log-filename utility",
      "Fix log filename project matching with centralized utility"
    ]
  },

  {
    version: "0.0.106",
    date: "2025-10-23",
    type: "minor",
    highlights: ["Add attribution requirement to fix_my_app tool description"]
  },

  {
    version: "0.0.105",
    date: "2025-10-23",
    type: "minor",
    highlights: [
      "Simplify changelog generation - remove pattern matching, just use git commit messages directly",
      "Update v0.0.104 changelog with proper custom command flag highlight and add pattern for future releases"
    ]
  },

  {
    version: "0.0.104",
    date: "2025-10-23",
    type: "patch",
    highlights: [
      '**Custom Command Flag**: New `--command` flag lets you override auto-detection and run any arbitrary command (e.g., `dev3000 --command "bun run dev"` or `dev3000 --command "uvicorn main:app --reload"`)'
    ]
  },

  {
    version: "0.0.103",
    date: "2025-10-23",
    type: "patch",
    highlights: [
      "**Smart Error Prioritization**: Automatically scores and ranks errors by severity - build errors (1000+), server errors (500+), browser errors (300+), with modifiers for recency and reproducibility",
      "**One-PR-Per-Run**: Creates focused single-issue PRs for the highest priority error - no more overwhelming multi-fix PRs",
      "**Improved Port Detection**: Works with non-standard ports (like Svelte's 5173) and shows loading spinner until port is confirmed"
    ]
  },

  {
    version: "0.0.102",
    date: "2025-10-23",
    type: "patch",
    highlights: [
      "**Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis",
      "**CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking",
      "**Improved TUI**: Better header and status line rendering for narrow terminal windows",
      "**Fixed 7 bugs for improved stability**"
    ]
  },

  {
    version: "0.0.101",
    date: "2025-10-22",
    type: "patch",
    highlights: ["**Fixed 3 bugs for improved stability**"]
  },

  {
    version: "0.0.100",
    date: "2025-10-22",
    type: "patch",
    highlights: [
      "**Critical Fix**: Added missing 'use client' directive to Button component for Next.js 16 compatibility",
      "**Logs Viewer**: Fixed 'Element type is invalid' error that broke the logs viewer in v0.0.99"
    ]
  },

  {
    version: "0.0.99",
    date: "2025-10-22",
    type: "minor",
    highlights: [
      "**Framework-Specific MCP Support**: Automatically detects project framework and spawns the appropriate MCP server (Next.js → `next-devtools-mcp`, Svelte → `@sveltejs/mcp-server-svelte`)",
      "**Smart Framework Detection**: Detects frameworks via config files and package.json dependencies",
      "**Next.js 16 Compatibility**: Updated to Next.js 16.0.0-canary with proper serialization fixes"
    ]
  },

  {
    version: "0.0.98",
    date: "2025-10-22",
    type: "patch",
    highlights: ["**Fixed 3 bugs for improved stability**"]
  },

  {
    version: "0.0.97",
    date: "2025-10-20",
    type: "patch",
    highlights: [
      "**Critical Fix**: Detect when server switches ports and update navigation - Chrome no longer gets stuck on loading page",
      "**Markdown Rendering**: Changelog pages now properly render markdown formatting (**bold**, [links](url)) in highlights",
      "**Shared Utilities**: Extracted markdown parsing into reusable functions for consistency"
    ]
  },

  {
    version: "0.0.96",
    date: "2025-10-18",
    type: "patch",
    highlights: [
      "**Non-Intrusive Health Checks**: Replaced HTTP HEAD requests with simple TCP port checks - no more interfering with auth middleware or polluting server logs",
      "**Better Compatibility**: Works seamlessly with apps using redirect-based auth without causing infinite loops"
    ]
  },

  {
    version: "0.0.95",
    date: "2025-10-17",
    type: "patch",
    highlights: [
      "**Bun Package Manager Support**: Added full support for Bun package manager (bun.lockb detection, bunx for MCP spawning)",
      "**Next.js DevTools MCP Integration**: Updated to use standalone next-devtools-mcp as stdio process with automatic spawning and lifecycle management",
      "Resolves [#8](https://github.com/vercel-labs/dev3000/issues/8)"
    ]
  },

  {
    version: "0.0.94",
    date: "2025-10-16",
    type: "patch",
    highlights: [
      "**Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available"
    ]
  },

  {
    version: "0.0.93",
    date: "2025-10-16",
    type: "patch",
    highlights: [
      "**Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available",
      "**Augmented Delegation**: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer",
      "Bug fixes improve overall reliability"
    ]
  },

  {
    version: "0.0.92",
    date: "2025-10-11",
    type: "patch",
    highlights: [
      "**Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis",
      "**CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking",
      "**Improved TUI**: Better header and status line rendering for narrow terminal windows"
    ]
  },

  {
    version: "0.0.91",
    date: "2025-10-10",
    type: "patch",
    highlights: [
      "**Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available",
      "Resolved GitHub issues [#12](https://github.com/anthropics/claude-code/issues/12)"
    ]
  },

  {
    version: "0.0.90",
    date: "2025-10-10",
    type: "patch",
    highlights: [
      "**Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis",
      "**CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking",
      "Bug fixes improve overall reliability"
    ]
  },

  {
    version: "0.0.89",
    date: "2025-10-10",
    type: "patch",
    highlights: [
      "**Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available"
    ]
  },

  {
    version: "0.0.88",
    date: "2025-10-09",
    type: "patch",
    highlights: ["Quality improvements and bug fixes"]
  },

  {
    version: "0.0.87",
    date: "2025-10-09",
    type: "patch",
    highlights: ["Bug fixes improve overall reliability"]
  },

  {
    version: "0.0.86",
    date: "2025-10-09",
    type: "patch",
    highlights: ["Bug fixes improve overall reliability"]
  },

  {
    version: "0.0.85",
    date: "2025-10-09",
    type: "patch",
    highlights: [
      "**Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis",
      "**CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking",
      "**Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available",
      "**Augmented Delegation**: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer",
      "**Fixed 3 bugs for improved stability**"
    ]
  },

  {
    version: "0.0.84",
    date: "2025-10-07",
    type: "patch",
    highlights: [
      "Shorter log file names: Removed dev3000- prefix from log files (saves 8 characters in terminal output)",
      "CHANGELOG.md generation: Auto-generates CHANGELOG.md from TypeScript changelog data during releases",
      "Log file paths now: project-timestamp.log, mcp.log, and project-d3k.log"
    ]
  },

  {
    version: "0.0.83",
    date: "2025-10-07",
    type: "patch",
    highlights: [
      "OpenCode MCP Support: Added auto-configuration for .opencode.json alongside Claude Code and Cursor",
      "OpenCode uses different format: type local with command arrays, proxied via @modelcontextprotocol/inspector for HTTP MCP servers",
      "All three AI CLIs now auto-configured: Claude Code (.mcp.json), Cursor (.cursor/mcp.json), and OpenCode (.opencode.json)"
    ]
  },

  {
    version: "0.0.82",
    date: "2025-10-07",
    type: "patch",
    highlights: [
      "Auto-Configuration for AI CLIs: Automatically writes .mcp.json (Claude Code) and .cursor/mcp.json (Cursor) so MCP servers are instantly available",
      "New find_component_source MCP tool: Maps DOM elements to React component source code by extracting the component function and providing targeted grep patterns to locate source files",
      "Removed get_react_component_info tool: React 19 removed __reactFiber$ properties from DOM nodes, making the old approach obsolete"
    ]
  },

  {
    version: "0.0.81",
    date: "2025-10-07",
    type: "minor",
    highlights: [
      "New analyze_visual_diff MCP tool provides detailed descriptions of before/after screenshot differences for CLS debugging",
      "Fixed CLS frame detection to show exact frames where layout shifts occur (N-2 and N-1), not just nearby frames",
      "fix_my_jank now includes direct links to screenshots showing the visual change that caused each layout shift",
      "Consolidated log tags (CONSOLE.ERROR → ERROR) and removed padding to maximize horizontal space for narrow terminals",
      "SERVER logs now extract and display HTTP methods (GET, POST, etc.) as secondary tags with smart alignment",
      "Changed 'video' to 'frame sequence' throughout to match actual functionality"
    ]
  },

  {
    version: "0.0.80",
    date: "2025-10-06",
    type: "minor",
    highlights: ["Added support for Arc and Comet browsers"]
  },

  {
    version: "0.0.79",
    date: "2025-10-06",
    type: "minor",
    highlights: [
      "Passive screencast capture automatically records page loads and navigations without slowing down your dev server",
      "CLS detection video viewer shows frame-by-frame video of layout shifts with red bounding boxes highlighting exactly which elements shifted",
      "Real PerformanceObserver integration uses browser APIs to detect actual layout shifts (not just pixel-diff guessing), with querySelector to find precise element positions",
      "New fix_my_jank MCP tool automatically analyzes performance issues and CLS problems, flagging critical UI shifts in NAV/HEADER elements",
      "Better header and status line rendering for narrow terminal windows"
    ]
  },

  {
    version: "0.0.78",
    date: "2025-10-03",
    type: "patch",
    highlights: [
      "Auto-configuration for AI CLIs: automatically writes .mcp.json (Claude Code) and .cursor/mcp.json (Cursor) so MCP servers are instantly available",
      "Intelligent Chrome launch: replaced fixed timeout with smart polling - dev3000 starts as soon as Chrome is ready instead of waiting arbitrarily",
      "Added comprehensive FAQ explaining sharp module warnings and other common questions",
      "Fixed log paths: corrected outdated log file paths in error messages for easier debugging"
    ]
  },

  {
    version: "0.0.77",
    date: "2025-09-30",
    type: "patch",
    highlights: [
      "Augmented delegation: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer",
      "Dynamic MCP discovery: automatically discovers and integrates with chrome-devtools MCP server via process detection and port scanning",
      "CDP URL sharing: shares Chrome DevTools Protocol URL with other MCPs to prevent duplicate browser instances",
      "Enhanced TUI: improved layout and dynamic capability display when MCP integrations are active"
    ]
  },

  {
    version: "0.0.76",
    date: "2025-09-30",
    type: "patch",
    highlights: [
      "Smart auto-delegation: re-enabled intelligent MCP delegation with Claude prompt caching detection to avoid token waste",
      "MCP integration refinements: improved how dev3000 coordinates with chrome-devtools MCP for seamless workflows"
    ]
  },

  {
    version: "0.0.75",
    date: "2025-09-29",
    type: "patch",
    highlights: [
      "MCP integration fixes: resolved issues with MCP server coordination and shutdown behavior",
      "Stability improvements: fixed edge cases in MCP integration that could cause unexpected behavior"
    ]
  },

  {
    version: "0.0.74",
    date: "2025-09-29",
    type: "minor",
    highlights: [
      "New development tools make debugging faster and more reliable",
      "Developer experience improvements across CLI and interface"
    ]
  },

  {
    version: "0.0.73",
    date: "2025-09-29",
    type: "patch",
    highlights: ["Browser automation now shares instances between tools, eliminating conflicts"]
  },

  {
    version: "0.0.72",
    date: "2025-09-25",
    type: "patch",
    highlights: [
      "Resolved GitHub issues [#34](https://github.com/anthropics/claude-code/issues/34)",
      "Build process optimized to prevent duplicate type generation",
      "Keyboard shortcuts now work consistently across all modes"
    ]
  },

  {
    version: "0.0.71",
    date: "2025-09-25",
    type: "patch",
    highlights: [
      "Improved Chrome browser shutdown and cleanup reliability",
      "Keyboard shortcuts now work consistently across all modes",
      "Developer experience improvements across CLI and interface"
    ]
  },

  {
    version: "0.0.70",
    date: "2025-09-25",
    type: "patch",
    highlights: [
      "Added GitHub Actions for automated release testing",
      "Global installation detection ensures dev3000 runs from correct location",
      "Bug fixes improve overall reliability"
    ]
  },

  {
    version: "0.0.69",
    date: "2025-09-25",
    type: "patch",
    highlights: [
      "Significant MCP server improvements for better AI integration",
      "Improved port management with intelligent auto-increment and conflict resolution",
      "Fixed 19 bugs for improved stability and reliability"
    ]
  },

  {
    version: "0.0.68",
    date: "2025-09-25",
    type: "minor",
    highlights: [
      "Significant MCP server improvements for better AI integration",
      "Improved port management with intelligent auto-increment and conflict resolution",
      "Fixed 12 bugs for improved stability and reliability",
      "Added several new features and enhancements"
    ]
  },

  {
    version: "0.0.67",
    date: "2025-09-23",
    type: "patch",
    highlights: [
      "Major Terminal UI improvements with enhanced visuals and user experience",
      "Significant MCP server improvements for better AI integration",
      "Improved log formatting with better alignment and readability"
    ]
  },

  {
    version: "0.0.66",
    date: "2025-09-22",
    type: "patch",
    highlights: ["Various improvements and bug fixes"]
  },

  {
    version: "0.0.65",
    date: "2025-09-22",
    type: "minor",
    highlights: [
      "Introduced gorgeous Terminal UI (TUI) as the default experience - a complete visual overhaul",
      "Revolutionized MCP server architecture: now a persistent singleton at localhost:3684/mcp",
      "Added multi-project support with project-specific Chrome profiles and session tracking",
      "Enhanced Visual Timeline with project parameter for seamless multi-project workflows",
      "Improved process management with better port handling and auto-increment capabilities"
    ]
  },

  {
    version: "0.0.64",
    date: "2025-09-19",
    type: "minor",
    highlights: [
      "Enhanced error debugging with 2x more context (20 lines of recent logs)",
      "Improved MCP server with dynamic log path handling for better flexibility",
      "Added beautiful changelog pages with auto-generated social media preview images",
      "Code quality improvements across the entire codebase"
    ]
  },

  {
    version: "0.0.63",
    date: "2025-09-17",
    type: "minor",
    highlights: [
      "Enhanced MCP tools with better AI guidance for improved debugging workflows",
      "Fixed changelog social media preview generation",
      "Added OpenAI Codex configuration support",
      "Improved React component stability"
    ]
  },

  {
    version: "0.0.62",
    date: "2025-09-17",
    type: "minor",
    highlights: [
      "Fixed Python/FastAPI server detection for better framework support",
      "Added comprehensive debug logging for troubleshooting server startup issues",
      "Improved server readiness detection across all frameworks",
      "Enhanced code quality and consistency"
    ]
  },

  {
    version: "0.0.61",
    date: "2025-09-16",
    type: "minor",
    highlights: [
      "Added --browser flag for custom browser support (Chrome, Chromium, Edge, etc.)",
      "Enhanced documentation with comprehensive usage examples"
    ]
  },

  {
    version: "0.0.60",
    date: "2025-09-16",
    type: "minor",
    highlights: [
      "Launched comprehensive changelog system with version history",
      "Redesigned MCP server homepage with better developer experience",
      "Improved code quality with enhanced linting rules"
    ]
  },

  {
    version: "0.0.60",
    date: "2025-01-16",
    type: "patch",
    highlights: [
      "Added periodic health checks to detect externally killed processes",
      "Enhanced error reporting with recent log lines on fatal exit",
      "Created magical MCP tool descriptions encouraging AI to proactively fix issues",
      "Added get_errors_between_timestamps and monitor_for_new_errors tools for continuous quality assurance"
    ]
  },
  {
    version: "0.0.49",
    date: "2025-01-15",
    type: "minor",
    highlights: [
      "Improved postinstall script with better logging and timeout handling",
      "Enhanced Chrome extension icon compatibility",
      "Fixed various stability issues with process management"
    ]
  },
  {
    version: "0.0.40",
    date: "2025-01-10",
    type: "minor",
    highlights: [
      "Introduced unified logging system with timestamped events",
      "Added automatic screenshot capture on errors and navigation",
      "Implemented MCP server integration for AI debugging workflows"
    ]
  },
  {
    version: "0.0.30",
    date: "2025-01-05",
    type: "minor",
    highlights: [
      "Added Chrome DevTools Protocol (CDP) monitoring",
      "Implemented persistent browser profile management",
      "Created consolidated log format for better AI consumption"
    ]
  },
  {
    version: "0.0.20",
    date: "2025-01-01",
    type: "minor",
    highlights: [
      "Initial release with basic server and browser monitoring",
      "Added support for Next.js, React, and other web frameworks",
      "Implemented core dev3000 CLI with port management"
    ]
  }
]

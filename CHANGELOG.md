# Changelog

All notable changes to dev3000 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.0.148] - 2026-01-15

**Feature Release**

- Update skills to fetch from new agent-skills repo path (`skills/` instead of `dx/skills/`)
- Add project vs global installation option for skills (`.claude/skills/` or `~/.claude/skills/`)
- Auto-cleanup deprecated skills on startup (`react-performance`, `vercel-design-guidelines`)
- Add comprehensive tests for process cleanup to prevent regressions
- Add extensive documentation to SIGHUP handler for cleanup invariants

## [0.0.147] - 2026-01-14

**Feature Release**

- Fix release script to exclude bun.lock from clean check
- Fix shutdown cleanup for tmux/TUI mode and debug mode
- Fix MCP cleanup in TUI mode - check PID file ownership
- Feat(cli): add --no-agent flag to skip agent selection prompt

## [0.0.146] - 2026-01-14

**Feature Release**

- Kill MCP server only when last d3k instance exits
- Fix skill installer offering already-installed project skills
- Fix MCP server startup for pnpm global installs
- Add agent-browser integration for browser automation

## [0.0.145] - 2026-01-13

**Feature Release**

- Add bundled skills to installer with React detection
- Fix skill discovery in compiled binary from any directory
- Add react-performance workflow type to d3k cloud
- Rename /performance skill to /react-performance
- Add /performance skill with React Performance Guidelines

## [0.0.144] - 2026-01-12

**Feature Release**

- Add compiled binary smoke test to release script
- Lint auto-fixes
- Fix TUI module bundling + LogEntry type export
- Rewrite design-guidelines workflow to use inline skill content
- Fix design-guidelines workflow to use reviewDesignGuidelines tool

## [0.0.143] - 2026-01-12

**Feature Release**

- Use dynamic import to avoid bundling OpenTUI for linux
- Add @opentui/core-linux-x64 for cross-compilation support
- Add Linux x64 platform support
- Add timing instrumentation to cloud workflows + sandbox snapshotting + ESLint fixes

## [0.0.143] - 2026-01-12

**Feature Release**

- Add Linux x64 platform support for running d3k in the cloud
- Build binaries for both darwin-arm64 and linux-x64 platforms

## [0.0.142] - 2026-01-10

**Patch Release**

- Fix process cleanup on all exit paths + TUI rendering improvements
- Fix shutdown: synchronous port kill FIRST in callback before anything else
- TUI: force redraw 500ms after startup to clear stale content
- Fix Ctrl+C: use direct callback instead of signals for shutdown
- Compact mode: remove bold from source tag, no space between tags

## [0.0.141] - 2026-01-09

**Feature Release**

- Update bun.lock
- Fix variable escaping in MCP polling command
- Fix skills not offered after .claude deletion + curl killed in polling
- Convert eslint-disable to biome-ignore comments
- Add release/publish workflow rules to CLAUDE.md

## [0.0.140] - 2026-01-09

**Feature Release**

- Fix MCP session discovery and add MCP server polling for agent startup
- Replace pnpm with npm in homepage documentation
- Remove redundant test step from publish.sh (tests already run in release.sh)
- Fix publish.sh to use vitest instead of bun test

## [0.0.139] - 2026-01-08

**Patch Release**

- Update bun.lock
- Fix bun lock file name in release scripts (bun.lock not bun-lock.yaml)

## [0.0.137] - 2026-01-07

**Feature Release**

- Fix tmux --with-agent error handling to show crash output
- Add vercel-design-guidelines workflow type

## [0.0.136] - 2026-01-07

**Feature Release**

- Fix tmux pane resize-on-focus and improve split-screen mode
- Reset to v0.0.135 for publishing
- Auto-update pnpm-lock.yaml on version bumps
- Add @d3k/darwin-arm64 to pnpm-lock.yaml for frozen-lockfile

## [0.0.135] - 2026-01-07

**Patch Release**

- Fix release tests to check exact platform package version
- Fix release script: bump version before building binaries
- Update pnpm-lock.yaml for @d3k/darwin-arm64 package rename

## [0.0.134] - 2026-01-07

**Patch Release**

- Update pnpm-lock.yaml
- Rename platform package from dev3000-darwin-arm64 to @d3k/darwin-arm64
- Move binary building from publish.sh to release.sh

## [0.0.133] - 2026-01-06

**Feature Release**

- Add skill installer for Vercel DX skills

## [0.0.132] - 2026-01-06

**Feature Release**

- Update pnpm-lock.yaml
- Skip clean install tests when platform package not on npm
- Fix release tests to skip npm install when platform package not on npm
- Add Bun compilation, graceful shutdown, and OpenCode MCP support
- Add agent selection prompt as default startup behavior

## [0.0.131] - 2026-01-06

**Feature Release**

- Switch CLI runtime from Node.js to Bun for better performance
- Add purple active pane border in tmux split-screen mode to show focus
- Fix Next.js server not being killed on exit (use PID-based cleanup)
- Fix MCP tools/list crash caused by JSON Schema vs Zod schema mismatch

## [0.0.130] - 2026-01-05

**Feature Release**

- Add --with-agent flag for split-screen mode with tmux

## [0.0.129] - 2026-01-05

**Feature Release**

- Fix npm global install detection and Next.js version mismatch
- Add auto-install d3k skill for Claude Code
- Fix multiple d3k instances killing each other's Chrome browsers
- Fix Web Vitals parsing to handle both response formats
- Fix MCP response parsing for SSE format

## [0.0.128] - 2025-12-22

**Patch Release**

- Use Chrome DevTools MCP performance trace for Web Vitals capture
- Fix Web Vitals capture to finalize LCP with user interaction
- Fix chrome-devtools MCP port mismatch by sorting session files by modification time
- Add CDP_URL environment variable support for MCP orchestration

## [0.0.127] - 2025-12-16

**Feature Release**

- Reduce log noise by making CDP layout shift logs conditional on --debug flag
- Add GitHub PAT support for automatic PR creation in workflows
- Simplify workflow architecture (v2) with better progress streaming
- Fix CLS measurement with 1920x1080 viewport in headless mode
- Improve workflow report UI with coordinated screenshot players

## [0.0.126] - 2025-12-11

**Feature Release**

- Remove nextjs-dev_browser_eval tool from MCP proxy whitelist
- Add withWorkflow wrapper to Next.js config
- Add /api/teams endpoint and use same-origin API for workflows
- Update WORKFLOW_TESTING_GUIDE with correct www project ID
- Refactor workflow into discrete steps with sandbox reconnection

## [0.0.125] - 2025-12-11

**Patch Release**

- Replace catalog: references with actual versions in mcp-server
- Move workflows UI from mcp-server to www

## [0.0.124] - 2025-12-11

**Patch Release**

- Fix Next.js port argument passing - remove -- separator
- Pass port argument to dev server when -p is specified
- Fix log file selector not showing previous logs
- Fix chrome-devtools-mcp CDP conflicts
- Replace hardcoded bypass token with env var reference in guide

## [0.0.123] - 2025-12-09

**Feature Release**

- Fix Chrome version detection and MCP discovery in sandbox
- Fix undefined resultStr error in agent transcript building
- Trigger redeploy
- Improve agent analysis capture and report page UX
- Add git diff and d3k logs display to workflow report page

## [0.0.122] - 2025-12-09

**Patch Release**

- Stop tracking auto-generated next-env.d.ts
- Use high ports in test-release.sh MCP startup test
- Fix test to actually use high port by setting PORT env var

## [0.0.121] - 2025-12-08

**Patch Release**

- Use high ports (>4000) in release tests to avoid conflicts

## [0.0.120] - 2025-12-08

**Feature Release**

- Fix orphaned Playwright/Chrome processes on startup
- Add debug logging for agent text output
- Fix blob overwrite error and update testing guide
- Add agentic AI with d3k sandbox tools for CLS fixing
- Save workflow reports incrementally to blob storage

## [0.0.119] - 2025-12-06

**Feature Release**

- Remove Next.js canary workaround from test-logs-api.ts
- Switch from Next.js canary to latest (16.0.7)
- Add server/instrumentation.js for Vercel build compatibility
- Fix Chrome launch issues and improve release test reliability
- Update pnpm.overrides to Next.js 16.1.0-canary.15

## [0.0.118] - 2025-12-05

**Feature Release**

- Update Next.js auto-generated type reference
- Remove network-idle screenshot spam
- Update AGENTS.md with correct vercel logs instructions
- Fix Step 1 timeout by ensuring clsData always truthy from Step 0
- Add CORS headers to /api/workflows endpoint

## [0.0.117] - 2025-12-05

**Patch Release**

- Fix server detection in sandbox environments

## [0.0.116] - 2025-12-05

**Feature Release**

- Add Vercel MCP tools section to WORKFLOW_TESTING_GUIDE
- Rewrite tool descriptions to enforce diagnose-fix-verify loop
- Capture d3k stdout/stderr to d3k-startup.log and dump logs on CDP failure
- Add always-on diagnostic logging to CDPMonitor for sandbox debugging
- Add Node.js spawn() diagnostic test for Chrome in sandbox

## [0.0.115] - 2025-12-05

**Patch Release**

- Fix tui-interface-impl test after upstream refactor
- Update next-env.d.ts types import path
- Simplify
- Always write session info after CDP monitoring for sandbox support
- Prevent flashing

## [0.0.114] - 2025-12-04

**Patch Release**

- Remove unused next dependency from root package.json
- Fix process cleanup to kill entire process group on shutdown

## [0.0.113] - 2025-12-04

**Feature Release**

- Update Next.js type definitions after build
- Add --headless flag for Chrome in serverless/CI environments
- Add screenshot columns to workflows table and fix SSE parsing
- Fix sandbox MCP response parsing and add log dumping
- Fix WORKFLOW_TESTING_GUIDE.md to use correct mcp-server production team

## [0.0.112] - 2025-12-02

**Feature Release**

- TUI improvements and MCP tool whitelist fixes for v0.0.112
- Upgrade workflow to 4.0.1-beta.23 with upstream @workflow/errors fix
- Trigger Vercel rebuild with workflow@4.0.1-beta.22 and @workflow/errors
- Update pnpm-lock.yaml for @workflow/errors dependency
- Add @workflow/errors as direct dependency for Vercel builds

## [0.0.111] - 2025-12-02

**Feature Release**

- Fix workflow@4.0.1-beta.22 build by adding pnpm override
- Upgrade workflow to 4.0.1-beta.22 with @workflow/errors dependency
- Emphasize CLI-only verification and add MCP tool whitelist
- Update WORKFLOW_TESTING_GUIDE to use d3k MCP tools instead of curl
- Revert workflow upgrade due to peer dependency issue

## [0.0.110] - 2025-12-01

**Patch Release**

- Update Next.js type references after route cleanup
- Remove Phase 1 POC artifacts
- Clean up unused artifacts and improve workflow testing
- Fix React duplicate key warnings on workflows page
- Trigger deployment

## [0.0.109] - 2025-11-18

**Patch Release**

- Fix lsof port checking to only skip in sandbox environments
- Disable lsof port checking entirely to fix sandbox crashes
- Fix lsof ENOENT crash by checking command existence first
- Fix TypeScript type safety in cloud workflow start
- .gitignore updates

## [0.0.108] - 2025-11-18

**Patch Release**

- Ignore TypeScript build info file
- Update Next.js build artifact (next-env.d.ts)
- Fix browser automation and multi-instance support
- Fix d3k command in cloud workflow Step 0 - remove invalid 'start' subcommand
- Fix d3k startup - use correct --no-tui flag

## [0.0.108] - 2025-11-07

**Feature Release**

- **MCP Config Control**: Use `--disable-mcp-configs`, `DEV3000_DISABLE_MCP_CONFIGS`, or `$XDG_CONFIG_HOME/dev3000/config.json` (falls back to `~/.config/dev3000/config.json`) to skip writing specific MCP config files (resolves [#58](https://github.com/vercel-labs/dev3000/issues/58))
- **User Config Defaults**: `$XDG_CONFIG_HOME/dev3000/config.json` (or `~/.config/dev3000/config.json`) now stores persistent CLI defaults like MCP config suppression

## [0.0.107] - 2025-10-28

**Patch Release**

- Fix module resolution for log-filename utility
- Fix log filename project matching with centralized utility

## [0.0.106] - 2025-10-23

**Feature Release**

- Add attribution requirement to fix_my_app tool description

## [0.0.105] - 2025-10-23

**Feature Release**

- Simplify changelog generation - remove pattern matching, just use git commit messages directly
- Update v0.0.104 changelog with proper custom command flag highlight and add pattern for future releases

## [0.0.104] - 2025-10-23

**Patch Release**

- **Custom Command Flag**: New `--command` flag lets you override auto-detection and run any arbitrary command (e.g., `dev3000 --command "bun run dev"` or `dev3000 --command "uvicorn main:app --reload"`)

## [0.0.103] - 2025-10-23

**Patch Release**

- **Smart Error Prioritization**: Automatically scores and ranks errors by severity - build errors (1000+), server errors (500+), browser errors (300+), with modifiers for recency and reproducibility
- **One-PR-Per-Run**: Creates focused single-issue PRs for the highest priority error - no more overwhelming multi-fix PRs
- **Improved Port Detection**: Works with non-standard ports (like Svelte's 5173) and shows loading spinner until port is confirmed

## [0.0.102] - 2025-10-23

**Patch Release**

- **Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis
- **CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking
- **Improved TUI**: Better header and status line rendering for narrow terminal windows
- **Fixed 7 bugs for improved stability**

## [0.0.101] - 2025-10-22

**Patch Release**

- **Fixed 3 bugs for improved stability**

## [0.0.100] - 2025-10-22

**Patch Release**

- **Critical Fix**: Added missing 'use client' directive to Button component for Next.js 16 compatibility
- **Logs Viewer**: Fixed 'Element type is invalid' error that broke the logs viewer in v0.0.99

## [0.0.99] - 2025-10-22

**Feature Release**

- **Framework-Specific MCP Support**: Automatically detects project framework and spawns the appropriate MCP server (Next.js → `next-devtools-mcp`, Svelte → `@sveltejs/mcp-server-svelte`)
- **Smart Framework Detection**: Detects frameworks via config files and package.json dependencies
- **Next.js 16 Compatibility**: Updated to Next.js 16.0.0-canary with proper serialization fixes

## [0.0.98] - 2025-10-22

**Patch Release**

- **Fixed 3 bugs for improved stability**

## [0.0.97] - 2025-10-20

**Patch Release**

- **Critical Fix**: Detect when server switches ports and update navigation - Chrome no longer gets stuck on loading page
- **Markdown Rendering**: Changelog pages now properly render markdown formatting (**bold**, [links](url)) in highlights
- **Shared Utilities**: Extracted markdown parsing into reusable functions for consistency

## [0.0.96] - 2025-10-18

**Patch Release**

- **Non-Intrusive Health Checks**: Replaced HTTP HEAD requests with simple TCP port checks - no more interfering with auth middleware or polluting server logs
- **Better Compatibility**: Works seamlessly with apps using redirect-based auth without causing infinite loops

## [0.0.95] - 2025-10-17

**Patch Release**

- **Bun Package Manager Support**: Added full support for Bun package manager (bun.lockb detection, bunx for MCP spawning)
- **Next.js DevTools MCP Integration**: Updated to use standalone next-devtools-mcp as stdio process with automatic spawning and lifecycle management
- Resolves [#8](https://github.com/vercel-labs/dev3000/issues/8)

## [0.0.94] - 2025-10-16

**Patch Release**

- **Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available

## [0.0.93] - 2025-10-16

**Patch Release**

- **Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available
- **Augmented Delegation**: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer
- Bug fixes improve overall reliability

## [0.0.92] - 2025-10-11

**Patch Release**

- **Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis
- **CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking
- **Improved TUI**: Better header and status line rendering for narrow terminal windows

## [0.0.91] - 2025-10-10

**Patch Release**

- **Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available
- Resolved GitHub issues [#12](https://github.com/anthropics/claude-code/issues/12)

## [0.0.90] - 2025-10-10

**Patch Release**

- **Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis
- **CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking
- Bug fixes improve overall reliability

## [0.0.89] - 2025-10-10

**Patch Release**

- **Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available

## [0.0.88] - 2025-10-09

**Patch Release**

- Quality improvements and bug fixes

## [0.0.87] - 2025-10-09

**Patch Release**

- Bug fixes improve overall reliability

## [0.0.86] - 2025-10-09

**Patch Release**

- Bug fixes improve overall reliability

## [0.0.85] - 2025-10-09

**Patch Release**

- **Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis
- **CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking
- **Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available
- **Augmented Delegation**: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer
- **Fixed 3 bugs for improved stability**

## [0.0.84] - 2025-10-07

**Patch Release**

- Shorter log file names: Removed dev3000- prefix from log files (saves 8 characters in terminal output)
- CHANGELOG.md generation: Auto-generates CHANGELOG.md from TypeScript changelog data during releases
- Log file paths now: project-timestamp.log, mcp.log, and project-d3k.log

## [0.0.83] - 2025-10-07

**Patch Release**

- OpenCode MCP Support: Added auto-configuration for .opencode.json alongside Claude Code and Cursor
- OpenCode uses different format: type local with command arrays, proxied via @modelcontextprotocol/inspector for HTTP MCP servers
- All three AI CLIs now auto-configured: Claude Code (.mcp.json), Cursor (.cursor/mcp.json), and OpenCode (.opencode.json)

## [0.0.82] - 2025-10-07

**Patch Release**

- Auto-Configuration for AI CLIs: Automatically writes .mcp.json (Claude Code) and .cursor/mcp.json (Cursor) so MCP servers are instantly available
- New find_component_source MCP tool: Maps DOM elements to React component source code by extracting the component function and providing targeted grep patterns to locate source files
- Removed get_react_component_info tool: React 19 removed __reactFiber$ properties from DOM nodes, making the old approach obsolete

## [0.0.81] - 2025-10-07

**Feature Release**

- New analyze_visual_diff MCP tool provides detailed descriptions of before/after screenshot differences for CLS debugging
- Fixed CLS frame detection to show exact frames where layout shifts occur (N-2 and N-1), not just nearby frames
- fix_my_jank now includes direct links to screenshots showing the visual change that caused each layout shift
- Consolidated log tags (CONSOLE.ERROR → ERROR) and removed padding to maximize horizontal space for narrow terminals
- SERVER logs now extract and display HTTP methods (GET, POST, etc.) as secondary tags with smart alignment
- Changed 'video' to 'frame sequence' throughout to match actual functionality

## [0.0.80] - 2025-10-06

**Feature Release**

- Added support for Arc and Comet browsers

## [0.0.79] - 2025-10-06

**Feature Release**

- Passive screencast capture automatically records page loads and navigations without slowing down your dev server
- CLS detection video viewer shows frame-by-frame video of layout shifts with red bounding boxes highlighting exactly which elements shifted
- Real PerformanceObserver integration uses browser APIs to detect actual layout shifts (not just pixel-diff guessing), with querySelector to find precise element positions
- New fix_my_jank MCP tool automatically analyzes performance issues and CLS problems, flagging critical UI shifts in NAV/HEADER elements
- Better header and status line rendering for narrow terminal windows

## [0.0.78] - 2025-10-03

**Patch Release**

- Auto-configuration for AI CLIs: automatically writes .mcp.json (Claude Code) and .cursor/mcp.json (Cursor) so MCP servers are instantly available
- Intelligent Chrome launch: replaced fixed timeout with smart polling - dev3000 starts as soon as Chrome is ready instead of waiting arbitrarily
- Added comprehensive FAQ explaining sharp module warnings and other common questions
- Fixed log paths: corrected outdated log file paths in error messages for easier debugging

## [0.0.77] - 2025-09-30

**Patch Release**

- Augmented delegation: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer
- Dynamic MCP discovery: automatically discovers and integrates with chrome-devtools MCP server via process detection and port scanning
- CDP URL sharing: shares Chrome DevTools Protocol URL with other MCPs to prevent duplicate browser instances
- Enhanced TUI: improved layout and dynamic capability display when MCP integrations are active

## [0.0.76] - 2025-09-30

**Patch Release**

- Smart auto-delegation: re-enabled intelligent MCP delegation with Claude prompt caching detection to avoid token waste
- MCP integration refinements: improved how dev3000 coordinates with chrome-devtools MCP for seamless workflows

## [0.0.75] - 2025-09-29

**Patch Release**

- MCP integration fixes: resolved issues with MCP server coordination and shutdown behavior
- Stability improvements: fixed edge cases in MCP integration that could cause unexpected behavior

## [0.0.74] - 2025-09-29

**Feature Release**

- New development tools make debugging faster and more reliable
- Developer experience improvements across CLI and interface

## [0.0.73] - 2025-09-29

**Patch Release**

- Browser automation now shares instances between tools, eliminating conflicts

## [0.0.72] - 2025-09-25

**Patch Release**

- Resolved GitHub issues [#34](https://github.com/anthropics/claude-code/issues/34)
- Build process optimized to prevent duplicate type generation
- Keyboard shortcuts now work consistently across all modes

## [0.0.71] - 2025-09-25

**Patch Release**

- Improved Chrome browser shutdown and cleanup reliability
- Keyboard shortcuts now work consistently across all modes
- Developer experience improvements across CLI and interface

## [0.0.70] - 2025-09-25

**Patch Release**

- Added GitHub Actions for automated release testing
- Global installation detection ensures dev3000 runs from correct location
- Bug fixes improve overall reliability

## [0.0.69] - 2025-09-25

**Patch Release**

- Significant MCP server improvements for better AI integration
- Improved port management with intelligent auto-increment and conflict resolution
- Fixed 19 bugs for improved stability and reliability

## [0.0.68] - 2025-09-25

**Feature Release**

- Significant MCP server improvements for better AI integration
- Improved port management with intelligent auto-increment and conflict resolution
- Fixed 12 bugs for improved stability and reliability
- Added several new features and enhancements

## [0.0.67] - 2025-09-23

**Patch Release**

- Major Terminal UI improvements with enhanced visuals and user experience
- Significant MCP server improvements for better AI integration
- Improved log formatting with better alignment and readability

## [0.0.66] - 2025-09-22

**Patch Release**

- Various improvements and bug fixes

## [0.0.65] - 2025-09-22

**Feature Release**

- Introduced gorgeous Terminal UI (TUI) as the default experience - a complete visual overhaul
- Revolutionized MCP server architecture: now a persistent singleton at localhost:3684/mcp
- Added multi-project support with project-specific Chrome profiles and session tracking
- Enhanced Visual Timeline with project parameter for seamless multi-project workflows
- Improved process management with better port handling and auto-increment capabilities

## [0.0.64] - 2025-09-19

**Feature Release**

- Enhanced error debugging with 2x more context (20 lines of recent logs)
- Improved MCP server with dynamic log path handling for better flexibility
- Added beautiful changelog pages with auto-generated social media preview images
- Code quality improvements across the entire codebase

## [0.0.63] - 2025-09-17

**Feature Release**

- Enhanced MCP tools with better AI guidance for improved debugging workflows
- Fixed changelog social media preview generation
- Added OpenAI Codex configuration support
- Improved React component stability

## [0.0.62] - 2025-09-17

**Feature Release**

- Fixed Python/FastAPI server detection for better framework support
- Added comprehensive debug logging for troubleshooting server startup issues
- Improved server readiness detection across all frameworks
- Enhanced code quality and consistency

## [0.0.61] - 2025-09-16

**Feature Release**

- Added --browser flag for custom browser support (Chrome, Chromium, Edge, etc.)
- Enhanced documentation with comprehensive usage examples

## [0.0.60] - 2025-09-16

**Feature Release**

- Launched comprehensive changelog system with version history
- Redesigned MCP server homepage with better developer experience
- Improved code quality with enhanced linting rules

## [0.0.60] - 2025-01-16

**Patch Release**

- Added periodic health checks to detect externally killed processes
- Enhanced error reporting with recent log lines on fatal exit
- Created magical MCP tool descriptions encouraging AI to proactively fix issues
- Added get_errors_between_timestamps and monitor_for_new_errors tools for continuous quality assurance

## [0.0.49] - 2025-01-15

**Feature Release**

- Improved postinstall script with better logging and timeout handling
- Enhanced Chrome extension icon compatibility
- Fixed various stability issues with process management

## [0.0.40] - 2025-01-10

**Feature Release**

- Introduced unified logging system with timestamped events
- Added automatic screenshot capture on errors and navigation
- Implemented MCP server integration for AI debugging workflows

## [0.0.30] - 2025-01-05

**Feature Release**

- Added Chrome DevTools Protocol (CDP) monitoring
- Implemented persistent browser profile management
- Created consolidated log format for better AI consumption

## [0.0.20] - 2025-01-01

**Feature Release**

- Initial release with basic server and browser monitoring
- Added support for Next.js, React, and other web frameworks
- Implemented core dev3000 CLI with port management


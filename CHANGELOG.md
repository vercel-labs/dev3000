# Changelog

All notable changes to dev3000 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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


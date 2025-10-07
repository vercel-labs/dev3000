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
    version: "0.0.81",
    date: "2025-10-07",
    type: "minor",
    highlights: [
      "🎬 **Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis",
      "🎯 **CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking",
      "🎨 **Improved TUI**: Better header and status line rendering for narrow terminal windows",
      "🌐 **Expanded Browser Support**: Added support for additional Chromium-based browsers",
      "🐛 **Fixed 7 bugs for improved stability**"
    ]
  },

  {
    version: "0.0.80",
    date: "2025-10-06",
    type: "minor",
    highlights: ["🌐 **Browser Support**: Added support for Arc and Comet browsers"]
  },

  {
    version: "0.0.79",
    date: "2025-10-06",
    type: "minor",
    highlights: [
      "🎬 **Passive Screencast Capture**: Automatically records page loads and navigations without slowing down your dev server",
      "🎯 **CLS Detection Video Viewer**: Watch frame-by-frame video of layout shifts with red bounding boxes highlighting exactly which elements shifted",
      "🔍 **Real PerformanceObserver Integration**: Uses browser APIs to detect actual layout shifts (not just pixel-diff guessing), with querySelector to find precise element positions",
      "⚡ **fix_my_jank Tool**: New MCP command automatically analyzes performance issues and CLS problems, flagging critical UI shifts in NAV/HEADER elements",
      "🎨 **Improved TUI**: Better header and status line rendering for narrow terminal windows"
    ]
  },

  {
    version: "0.0.78",
    date: "2025-10-03",
    type: "patch",
    highlights: [
      "🔧 **Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available",
      "⚡ **Intelligent Chrome Launch**: Replaced fixed timeout with smart polling - dev3000 starts as soon as Chrome is ready instead of waiting arbitrarily",
      "📚 **FAQ Section**: Added comprehensive FAQ explaining sharp module warnings and other common questions",
      "🐛 **Fixed Log Paths**: Corrected outdated log file paths in error messages for easier debugging"
    ]
  },

  {
    version: "0.0.77",
    date: "2025-09-30",
    type: "patch",
    highlights: [
      "🤖 **Augmented Delegation**: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer",
      "🔍 **Dynamic MCP Discovery**: Automatically discovers and integrates with chrome-devtools MCP server via process detection and port scanning",
      "📡 **CDP URL Sharing**: Shares Chrome DevTools Protocol URL with other MCPs to prevent duplicate browser instances",
      "🎨 **Enhanced TUI**: Improved layout and dynamic capability display when MCP integrations are active"
    ]
  },

  {
    version: "0.0.76",
    date: "2025-09-30",
    type: "patch",
    highlights: [
      "🧠 **Smart Auto-Delegation**: Re-enabled intelligent MCP delegation with Claude prompt caching detection to avoid token waste",
      "⚙️ **MCP Integration Refinements**: Improved how dev3000 coordinates with chrome-devtools MCP for seamless workflows"
    ]
  },

  {
    version: "0.0.75",
    date: "2025-09-29",
    type: "patch",
    highlights: [
      "🔧 **MCP Integration Fixes**: Resolved issues with MCP server coordination and shutdown behavior",
      "🛡️ **Stability Improvements**: Fixed edge cases in MCP integration that could cause unexpected behavior"
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

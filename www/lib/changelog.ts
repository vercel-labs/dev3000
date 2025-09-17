export type ReleaseType = 'major' | 'minor' | 'patch'

export interface Release {
  version: string
  date: string
  type: ReleaseType
  highlights: string[]
}

// Changelog data structure - this will be updated by the release script
export const changelog: Release[] = [
  {
    version: "0.0.62",
    date: "2025-09-17",
    type: "minor",
    highlights: [
      "Fix linter formatting in next-env.d.ts",
      "Clean up code formatting and bump to v0.0.62-canary",
      "Fix server readiness check for FastAPI/Python servers",
      "Add comprehensive server startup debug logging"
    ]
  },

  {
    version: "0.0.61",
    date: "2025-09-16",
    type: "minor",
    highlights: [
      "Update README with --browser flag documentation",
      "Add --browser flag to support custom browser executables"
    ]
  },

  {
    version: "0.0.60",
    date: "2025-09-16",
    type: "minor",
    highlights: ["Fix linting issues from biome", "Add comprehensive changelog system and enhance MCP server homepage"]
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
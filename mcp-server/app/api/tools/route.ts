import { NextResponse } from "next/server"

// This endpoint extracts MCP tools documentation by parsing the route handler
export async function GET() {
  try {
    // Since we can't easily parse the TypeScript at runtime,
    // we'll maintain a curated list of tools with their descriptions
    const tools = [
      {
        name: "debug_my_app",
        description: "🚨 SHORTCUT COMMAND: Complete proactive analysis of your development environment. Automatically checks recent logs for errors, searches for common patterns, gets browser errors, and provides actionable debugging insights with immediate fixes.",
        category: "Primary Debugging",
        parameters: [
          {
            name: "focusArea",
            type: "string",
            optional: true,
            description: "Specific area to focus on: 'build', 'runtime', 'network', 'ui', or 'all' (default: 'all')"
          }
        ]
      },
      {
        name: "get_current_timestamp",
        description: "⏰ CRITICAL MONITORING TOOL: Get current timestamp for proactive error monitoring workflow. Use constantly before/after user interactions for timestamp-based debugging.",
        category: "Monitoring",
        parameters: []
      },
      {
        name: "get_errors_between_timestamps",
        description: "🚨 PROACTIVE ERROR EXTRACTION: Get ALL types of errors (server errors, exceptions, browser errors, build failures, network issues) between specific timestamps. Essential for continuous monitoring.",
        category: "Error Analysis",
        parameters: [
          {
            name: "startTime",
            type: "string",
            description: "Start timestamp (ISO 8601 format: 2024-01-01T12:00:00.000Z)"
          },
          {
            name: "endTime", 
            type: "string",
            description: "End timestamp (ISO 8601 format: 2024-01-01T12:30:00.000Z)"
          },
          {
            name: "severity",
            type: "enum",
            optional: true,
            description: "Error severity filter: 'all', 'critical', 'warnings' (default: 'all')"
          }
        ]
      },
      {
        name: "monitor_for_new_errors",
        description: "🔍 AUTOMATED BACKGROUND MONITORING: Check for ANY new errors that appeared in the last few minutes. Use frequently for continuous quality assurance and preventive debugging.",
        category: "Monitoring",
        parameters: [
          {
            name: "minutes",
            type: "number",
            optional: true,
            description: "Minutes to look back for new errors (default: 5)"
          },
          {
            name: "autoFix",
            type: "boolean", 
            optional: true,
            description: "Whether to immediately offer fixes when errors found (default: true)"
          }
        ]
      },
      {
        name: "read_consolidated_logs",
        description: "Read recent consolidated development logs containing server output, browser console logs, network requests, user interactions, and screenshots. Essential for general log overview and proactive error detection.",
        category: "Log Analysis",
        parameters: [
          {
            name: "lines",
            type: "number",
            optional: true,
            description: "Number of recent lines to read (default: 50)"
          },
          {
            name: "filter",
            type: "string",
            optional: true,
            description: "Filter logs by text content"
          }
        ]
      },
      {
        name: "search_logs",
        description: "Search through consolidated logs using regex patterns with context lines. Essential for tracing error patterns, finding specific API calls, or tracking user interaction sequences.",
        category: "Log Analysis", 
        parameters: [
          {
            name: "pattern",
            type: "string",
            description: "Regex pattern to search for"
          },
          {
            name: "context",
            type: "number",
            optional: true,
            description: "Number of lines of context around matches (default: 2)"
          }
        ]
      },
      {
        name: "get_logs_between_timestamps",
        description: "Get logs between two specific timestamps - critical for timestamp-based debugging workflow. Eliminates noise and focuses analysis on specific user sessions.",
        category: "Log Analysis",
        parameters: [
          {
            name: "startTime", 
            type: "string",
            description: "Start timestamp (ISO 8601 format)"
          },
          {
            name: "endTime",
            type: "string", 
            description: "End timestamp (ISO 8601 format)"
          },
          {
            name: "filter",
            type: "string",
            optional: true,
            description: "Filter logs by text content (case insensitive)"
          }
        ]
      },
      {
        name: "get_browser_errors",
        description: "Get recent browser errors including console errors, JavaScript exceptions, and page errors from monitoring. Use proactively to catch JavaScript exceptions and runtime issues immediately.",
        category: "Browser Debugging",
        parameters: [
          {
            name: "hours",
            type: "number",
            optional: true,
            description: "Hours to look back (default: 1)"
          }
        ]
      },
      {
        name: "execute_browser_action", 
        description: "🪄 MAGICAL VERIFICATION TOOL: Execute safe browser actions via Chrome DevTools Protocol for testing and interaction automation. The secret to dev3000 magic - use to verify fixes work by automating browser interactions and taking screenshots.",
        category: "Browser Automation",
        parameters: [
          {
            name: "action",
            type: "enum",
            description: "Action to perform: 'click', 'navigate', 'screenshot', 'evaluate', 'scroll', 'type'"
          },
          {
            name: "params",
            type: "object",
            description: "Parameters for the action (coordinates, URL, selector, text, expression, etc.)"
          }
        ]
      },
      {
        name: "healthcheck",
        description: "Internal healthcheck tool - rarely needed since MCP connection working means server is healthy. Only use if explicitly asked to verify server health.",
        category: "System",
        parameters: [
          {
            name: "message",
            type: "string",
            optional: true,
            description: "Optional message to echo back"
          }
        ]
      }
    ]

    return NextResponse.json({
      tools,
      endpoint: "http://localhost:3684/api/mcp/mcp",
      totalTools: tools.length,
      categories: [...new Set(tools.map(t => t.category))]
    })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to extract tools documentation" },
      { status: 500 }
    )
  }
}
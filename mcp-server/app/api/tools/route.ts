import { NextResponse } from "next/server"

// This endpoint extracts MCP tools documentation by parsing the route handler
export async function GET() {
  try {
    // Streamlined tool set - reduced from 10 tools to 2 for zero authorization friction!
    const tools = [
      {
        name: "debug_my_app",
        description:
          "🚀 THE ULTIMATE DEBUGGING TOOL: Everything you need in one streamlined tool! Combines functionality of 8+ separate tools with zero authorization friction. Supports snapshot mode (immediate analysis), bisect mode (timestamp-based debugging with user interaction), and monitor mode (continuous monitoring). Automatically handles error detection, log analysis, browser errors, build issues, network problems, and actionable insights. The only debugging tool you'll ever need!",
        category: "Ultimate Debugging",
        parameters: [
          {
            name: "focusArea",
            type: "string",
            optional: true,
            description: "Specific area: 'build', 'runtime', 'network', 'ui', 'all' (default: 'all')"
          },
          {
            name: "mode",
            type: "enum",
            optional: true,
            description: "Debug mode: 'snapshot' (immediate), 'bisect' (timestamp-based), 'monitor' (continuous)"
          },
          {
            name: "waitForUserInteraction",
            type: "boolean",
            optional: true,
            description: "In bisect mode: capture timestamp, wait for user testing, then analyze (default: false)"
          },
          {
            name: "timeRangeMinutes",
            type: "number",
            optional: true,
            description: "Minutes to analyze back from now (default: 10)"
          },
          {
            name: "includeTimestampInstructions",
            type: "boolean",
            optional: true,
            description: "Show timestamp-based debugging instructions (default: true)"
          }
        ]
      },
      {
        name: "execute_browser_action",
        description:
          "🪄 MAGICAL VERIFICATION TOOL: Execute safe browser actions via Chrome DevTools Protocol for testing and interaction automation. The secret to dev3000 magic - use to verify fixes work by automating browser interactions, taking screenshots, and testing functionality. Essential companion to debug_my_app for the complete magical debugging experience.",
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
      }
    ]

    return NextResponse.json({
      tools,
      endpoint: "http://localhost:3684/api/mcp/mcp",
      totalTools: tools.length,
      categories: [...new Set(tools.map((t) => t.category))]
    })
  } catch (error) {
    return NextResponse.json({ error: "Failed to extract tools documentation" }, { status: 500 })
  }
}

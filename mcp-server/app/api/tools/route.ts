import { NextResponse } from "next/server"

// This endpoint extracts MCP tools documentation by parsing the route handler
export async function GET() {
  try {
    const tools = [
      {
        name: "fix_my_app",
        description:
          "Analyzes dev3000 logs to diagnose application errors and returns a prioritized report.\n\n**IMPORTANT:** This tool returns diagnostic information - it does NOT automatically fix anything. You must read the output and take action on reported issues.\n\n**What it does:**\n• Parses server logs, browser console, and network activity\n• Categorizes errors by type (build, server, browser, network, warnings)\n• Prioritizes issues by severity\n• Shows user interactions that preceded each error\n• Suggests fix approaches when determinable\n\n**Modes:**\n• snapshot (default): Analyze current state\n• bisect: Compare before/after states\n• monitor: Continuous monitoring\n\n**After calling:**\n1. Read the diagnostic output\n2. Fix reported issues\n3. Use execute_browser_action to verify\n4. Call fix_my_app again to confirm resolution",
        category: "Diagnostics",
        parameters: [
          {
            name: "focusArea",
            type: "string",
            optional: true,
            description: "Area to analyze: 'build', 'runtime', 'network', 'ui', 'performance', 'all' (default: 'all')"
          },
          {
            name: "mode",
            type: "enum",
            optional: true,
            description: "Analysis mode: 'snapshot', 'bisect', 'monitor'"
          },
          {
            name: "waitForUserInteraction",
            type: "boolean",
            optional: true,
            description: "In bisect mode: wait for user testing before analyzing (default: false)"
          },
          {
            name: "timeRangeMinutes",
            type: "number",
            optional: true,
            description: "Minutes to analyze (default: 10)"
          },
          {
            name: "createPR",
            type: "boolean",
            optional: true,
            description: "Create a PR branch for the highest-priority issue (default: false)"
          }
        ]
      },
      {
        name: "execute_browser_action",
        description:
          "Executes browser actions in the dev3000-managed Chrome instance.\n\n**Actions:**\n• click: Click at coordinates {x, y}\n• navigate: Go to a URL\n• scroll: Scroll by {x, y} pixels\n• type: Type text into focused element\n• evaluate: Execute JavaScript (read-only recommended)\n• screenshot: Capture current page\n\n**Use cases:**\n• Reproducing user interactions that triggered errors\n• Verifying fixes work correctly\n• Testing UI workflows\n\n**Note:** Screenshots are auto-captured on navigation and errors. Use this for interaction reproduction, not manual screenshots.",
        category: "Browser Automation",
        parameters: [
          {
            name: "action",
            type: "enum",
            description: "Action: 'click', 'navigate', 'screenshot', 'evaluate', 'scroll', 'type'"
          },
          {
            name: "params",
            type: "object",
            description: "Action parameters (coordinates, URL, text, expression, etc.)"
          }
        ]
      }
      // TODO: Commenting out for now - need to figure out the right approach for proactive monitoring
      /*
      ,{
        name: "start_error_monitoring",
        description:
          "🔍 **SIMPLE ERROR MONITORING** - Starts a lightweight background process that watches your app for errors and alerts you in real-time.\n\n⚡ **INSTANT ACTIVATION:**\n• Claude offers to run the monitoring script immediately\n• Just say 'yes' or 'monitor my app' to start\n• Simple 15-line Python script that just works\n• Real-time alerts when errors occur\n\n💡 **WHAT IT DOES:**\n• Watches for ERROR, FAIL, Exception, TypeError, CRASH keywords\n• Shows the error line when detected\n• Prompts you to let Claude debug\n• That's it - simple and effective!\n\n🎯 **USAGE FLOW:**\n1. User: 'monitor my app'\n2. Claude: 'Should I start monitoring now?'\n3. User: 'yes'\n4. Claude runs the script → monitoring active\n5. When errors appear → 'Tell me: debug my app'\n\n✨ **THE BEAUTY:**\n• No complex features - just works\n• Lightweight and fast\n• Perfect for quick error detection",
        category: "Monitoring",
        parameters: [
          {
            name: "projectName",
            type: "string",
            optional: true,
            description: "Project name to monitor (if multiple dev3000 instances are running)"
          }
        ]
      }
      */
    ]

    return NextResponse.json({
      tools,
      endpoint: `http://localhost:${process.env.PORT || "3684"}/mcp`,
      totalTools: tools.length,
      categories: [...new Set(tools.map((t) => t.category))]
    })
  } catch (_error) {
    return NextResponse.json({ error: "Failed to extract tools documentation" }, { status: 500 })
  }
}

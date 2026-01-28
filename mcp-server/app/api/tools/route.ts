import { NextResponse } from "next/server"

// This endpoint extracts MCP tools documentation by parsing the route handler
export async function GET() {
  try {
    const tools = [
      {
        name: "fix_my_app",
        description:
          "Diagnoses application errors from dev3000 logs. Returns prioritized issues requiring fixes.\n\n**CRITICAL: Use in a loop until all errors are resolved:**\n1. DIAGNOSE: Call fix_my_app to get errors\n2. FIX: Fix the highest-priority error\n3. VERIFY: Call fix_my_app again to confirm fix worked\n4. REPEAT: Loop until no errors remain\n\n**This tool does NOT fix anything automatically.** You must read the output, fix issues, and call again to verify.\n\n**What it analyzes:** Server logs, browser console, network requests. Prioritizes by severity (build > server > browser > network > warnings).",
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
        name: "agent_browser_action",
        description:
          "Browser automation with persistent sessions using agent-browser CLI.\n\n**Actions:**\n• open: Navigate to URL\n• click: Click element by ref (@e1) or selector\n• type: Type text into focused element\n• fill: Fill input field\n• scroll: Scroll page\n• screenshot: Capture current page\n• snapshot: Get page elements with refs for clicking\n• evaluate: Execute JavaScript\n• reload: Reload page\n\n**Features:**\n• Persistent sessions (cookies, localStorage, logins)\n• Project-specific browser profile\n• Reliable Playwright-based automation",
        category: "Browser Automation",
        parameters: [
          {
            name: "action",
            type: "enum",
            description:
              "Action: 'open', 'click', 'type', 'fill', 'scroll', 'screenshot', 'snapshot', 'evaluate', 'reload', 'back', 'close'"
          },
          {
            name: "params",
            type: "object",
            description: "Action parameters (url, target, text, expression, etc.)"
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

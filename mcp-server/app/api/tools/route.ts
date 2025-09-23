import { NextResponse } from "next/server"

// This endpoint extracts MCP tools documentation by parsing the route handler
export async function GET() {
  try {
    // Streamlined tool set - reduced from 10 tools to 2 for zero authorization friction!
    const tools = [
      {
        name: "fix_my_app",
        description:
          "🔧 **THE ULTIMATE FIND→FIX→VERIFY MACHINE!** This isn't just debugging—it's MAGICAL problem-solving that FIXES your app! 🪄\n\n🔥 **INSTANT FIX POWERS:**\n• FINDS: Server errors, browser crashes, build failures, API issues, performance problems—EVERYTHING\n• FIXES: Provides EXACT code fixes with file locations and line numbers\n• GUIDES: Step-by-step implementation of fixes\n• VERIFIES: Ensures fixes actually resolve the issues\n\n🚀 **3 ACTION MODES:**\n• **FIX NOW** (default): \"What's broken RIGHT NOW?\" → Find and fix immediately\n• **FIX REGRESSION**: \"What broke during testing?\" → Compare before/after and fix\n• **FIX CONTINUOUSLY**: \"Fix issues as they appear\" → Monitor and fix proactively\n\n⚡ **THE FIX-IT WORKFLOW:**\n1️⃣ I FIND all issues instantly\n2️⃣ I provide EXACT FIXES with code\n3️⃣ You implement the fixes\n4️⃣ We VERIFY everything works\n\n🎪 **WHY THIS TOOL IS MAGIC:**\n• Goes beyond debugging to actual fixing\n• Provides copy-paste fix code\n• Works with 'fix my app' or 'debug my app'\n• Makes broken apps work again!\n• You become the fix-it hero!\n\n💡 **PRO TIPS:**\n• Say 'fix my app' for instant error resolution\n• Use execute_browser_action to verify fixes\n• This tool doesn't just find problems—it SOLVES them!",
        category: "Error Fixing",
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
            description: "Fix mode: 'snapshot' (fix now), 'bisect' (fix regression), 'monitor' (fix continuously)"
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
          "🪄 **SMART INTERACTION TESTING** - Use for targeted user workflow verification! 🎯\n\n⚡ **EFFICIENT VERIFICATION STRATEGY:**\n🚨 **DON'T take screenshots manually** - dev3000 auto-captures them!\n✅ **DO use this for:** click, navigate, scroll, type to reproduce user interactions\n✅ **DO verify fixes by:** reproducing the original error scenario, then check fix_my_app for verification\n\n🔥 **BROWSER ACTIONS:**\n• CLICK buttons/links → Test specific user interactions\n• NAVIGATE to pages → Reproduce user journeys  \n• SCROLL & TYPE → Simulate user workflows\n• EVALUATE JavaScript → Check app state (read-only)\n\n⚡ **OPTIMAL FIX VERIFICATION WORKFLOW:**\n1️⃣ fix_my_app finds issues + provides exact fixes\n2️⃣ You implement the fix code\n3️⃣ Use execute_browser_action to REPRODUCE the original interaction\n4️⃣ Run fix_my_app again to verify the fix worked\n\n🎯 **PERFECT FOR:**\n• Verifying fixes actually resolve the errors\n• Testing interactions after implementing fixes\n• Confirming forms work, buttons respond, etc.\n• Ensuring the app works correctly after fixes\n\n🚫 **AVOID:** Manual screenshot action (dev3000 auto-captures)\n✅ **USE:** Interaction reproduction + fix_my_app for verification\n\n🛡️ **SAFETY:** Safe operations only, read-only JS evaluation",
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

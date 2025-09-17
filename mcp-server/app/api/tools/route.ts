import { NextResponse } from "next/server"

// This endpoint extracts MCP tools documentation by parsing the route handler
export async function GET() {
  try {
    // Streamlined tool set - reduced from 10 tools to 2 for zero authorization friction!
    const tools = [
      {
        name: "debug_my_app",
        description:
          "🎯 **THE ULTIMATE FIND→FIX→VERIFY MACHINE!** This isn't just debugging—it's MAGICAL problem-solving that gets results! 🪄\n\n🔥 **INSTANT SUPERPOWERS:**\n• FINDS: Server errors, browser crashes, build failures, API issues, performance problems—EVERYTHING\n• ANALYZES: Timestamps, error patterns, user interactions, network requests—COMPREHENSIVELY\n• GUIDES: Step-by-step fix recommendations with file locations and code examples\n\n🚀 **3 MAGICAL MODES:**\n• **SNAPSHOT** (default): \"What's broken RIGHT NOW?\" → Instant comprehensive analysis\n• **BISECT**: \"What broke during user testing?\" → Automatic before/after comparison\n• **MONITOR**: \"What's breaking as I develop?\" → Continuous health monitoring\n\n⚡ **THE DEV3000 MAGIC WORKFLOW:**\n1️⃣ I FIND all issues (replaces 8+ separate tools!)\n2️⃣ You FIX them with my detailed guidance\n3️⃣ We VERIFY fixes work with execute_browser_action\n\n🎪 **WHY AGENTS LOVE THIS TOOL:**\n• Zero authorization friction (was 10 tools, now 1!)\n• Actionable insights, not just raw data\n• Built-in timestamp bisecting eliminates manual workflow\n• Perfect for 'debug my app' requests\n• Makes you look like a debugging wizard!\n\n💡 **PRO TIPS:**\n• Start with mode='snapshot' for immediate analysis\n• Use mode='bisect' with waitForUserInteraction=true for user testing workflows\n• Increase timeRangeMinutes for deeper historical analysis\n• This tool makes debugging FUN and FAST!",
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
          "🪄 **THE VERIFICATION MAGIC WAND!** This is where dev3000 becomes TRULY magical—proving your fixes work with real browser automation! 🎭\n\n🔥 **INSTANT BROWSER SUPERPOWERS:**\n• CLICK buttons, links, elements (test user interactions)\n• NAVIGATE to pages (reproduce user journeys)\n• SCREENSHOT everything (visual proof of fixes)\n• EVALUATE JavaScript (check app state)\n• SCROLL & TYPE (automate complex workflows)\n\n⚡ **THE ULTIMATE FIX VERIFICATION WORKFLOW:**\n1️⃣ debug_my_app FINDS the issues\n2️⃣ You FIX the code\n3️⃣ execute_browser_action PROVES it works!\n\n🎯 **PERFECT FOR:**\n• Taking screenshots to show \"before/after\" fixes\n• Testing that broken buttons now work\n• Verifying forms submit correctly\n• Confirming pages load without errors\n• Automating user interaction testing\n• Creating visual proof of improvements\n\n🚀 **WHY THIS COMPLETES THE MAGIC:**\n• Agents can SHOW users the fixes work (not just claim it)\n• Real browser testing, not theoretical fixes\n• Screenshots provide visual confirmation\n• Automates the boring verification work\n• Makes debugging feel like actual magic!\n\n💡 **PRO WORKFLOW:**\n• Always screenshot before fixes (baseline)\n• Make your code changes\n• Use navigate/click/screenshot to verify fixes\n• Take final screenshot showing success!\n\n🛡️ **SAFETY BUILT-IN:**\n• Only safe, whitelisted operations\n• No harmful actions possible\n• Read-only JavaScript evaluation\n• HTTP/HTTPS URLs only",
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

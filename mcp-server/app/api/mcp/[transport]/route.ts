import { existsSync, readFileSync } from "fs"
import { createMcpHandler } from "mcp-handler"
import { WebSocket } from "ws"
import { z } from "zod"

const handler = createMcpHandler(
  (server) => {
    // Debug my app - comprehensive proactive analysis
    server.tool(
      "debug_my_app",
      "🚨 SHORTCUT COMMAND: Complete proactive analysis of your development environment. When user says 'debug my app' or similar, use THIS tool instead of trying to read files manually. This tool automatically: (1) Checks recent logs for errors and exceptions, (2) Searches for common error patterns, (3) Gets browser errors, (4) Provides actionable debugging insights with IMMEDIATE FIXES. MAGIC WORKFLOW: After identifying issues, immediately offer to fix them by editing code files, then use execute_browser_action to verify the fix works. This creates the magical dev3000 experience where AI doesn't just find bugs but FIXES and VERIFIES them automatically!",
      {
        focusArea: z
          .string()
          .optional()
          .describe("Specific area to focus on: 'build', 'runtime', 'network', 'ui', or 'all' (default: 'all')")
      },
      async ({ focusArea = "all" }) => {
        const logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log"
        const results: string[] = []
        
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text", 
                  text: `❌ No dev3000 logs found at ${logPath}. Make sure dev3000 is running (d3k or dev3000 command). If you're not using dev3000, I'll need you to specify which log files to check.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n").filter(line => line.trim())
          
          results.push("🔍 **COMPREHENSIVE APP DEBUG ANALYSIS**\n")
          
          // 1. Check for recent errors
          const recentLines = logLines.slice(-100)
          const errorLines = recentLines.filter(line => 
            line.includes("ERROR") || 
            line.includes("Exception") || 
            line.includes("FAIL") ||
            line.includes("500") || 
            line.includes("404") ||
            line.includes("timeout")
          )
          
          if (errorLines.length > 0) {
            results.push("🚨 **RECENT ERRORS DETECTED:**")
            results.push(errorLines.slice(-10).join("\n"))
            results.push("")
            results.push("🔧 **IMMEDIATE ACTION REQUIRED:** I can help fix these errors right now! Let me:")
            results.push("• Analyze the error patterns and identify root causes")
            results.push("• Edit the problematic code files to fix the issues") 
            results.push("• Use browser automation to verify the fixes work")
            results.push("• This is the magical dev3000 experience - AI that fixes, not just finds!")
            results.push("")
          } else {
            results.push("✅ No recent errors in last 100 log entries")
          }

          // 2. Check browser errors (last hour)
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
          const browserErrors = logLines.filter(line => {
            if (!line.includes("[BROWSER]")) return false
            if (!(line.includes("ERROR") || line.includes("CONSOLE ERROR"))) return false
            
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime > oneHourAgo
            }
            return true
          })
          
          if (browserErrors.length > 0) {
            results.push("🌐 **BROWSER ERRORS (LAST HOUR):**")
            results.push(browserErrors.join("\n"))
            results.push("")
            results.push("🎯 **FRONTEND FIXES AVAILABLE:** I can immediately:")
            results.push("• Fix JavaScript errors by editing the problematic components")
            results.push("• Update type definitions to resolve TypeScript issues")
            results.push("• Use execute_browser_action to test the fixes in real-time")
            results.push("• Capture screenshots to verify UI improvements")
            results.push("")
          } else {
            results.push("✅ No browser errors in the last hour")
          }

          // 3. Check for build/compilation issues
          if (focusArea === "all" || focusArea === "build") {
            const buildErrors = recentLines.filter(line =>
              line.includes("Failed to compile") ||
              line.includes("Build failed") ||
              line.includes("Type error") ||
              line.includes("Syntax error") ||
              line.includes("Module not found")
            )
            
            if (buildErrors.length > 0) {
              results.push("🔨 **BUILD/COMPILATION ISSUES:**")
              results.push(buildErrors.join("\n"))
              results.push("")
              results.push("⚡ **BUILD FIXES READY:** I can instantly:")
              results.push("• Fix TypeScript errors by updating type annotations")
              results.push("• Resolve import/export issues by correcting module paths")
              results.push("• Install missing dependencies automatically")
              results.push("• Run the build again to verify everything compiles")
              results.push("")
            }
          }

          // 4. Check for network issues
          if (focusArea === "all" || focusArea === "network") {
            const networkIssues = recentLines.filter(line =>
              line.includes("NETWORK") && (
                line.includes("failed") ||
                line.includes("timeout") ||
                line.includes("500") ||
                line.includes("404")
              )
            )
            
            if (networkIssues.length > 0) {
              results.push("🌐 **NETWORK ISSUES:**")
              results.push(networkIssues.join("\n"))
              results.push("")
              results.push("🚀 **API FIXES INCOMING:** I can automatically:")
              results.push("• Fix API endpoint configurations and route handlers")
              results.push("• Update fetch calls with proper error handling")
              results.push("• Test API endpoints using execute_browser_action")
              results.push("• Verify network requests work in the browser")
              results.push("")
            }
          }

          // 5. Summary and magical next steps
          results.push("💡 **THE MAGIC HAPPENS NOW:**")
          if (errorLines.length > 0 || browserErrors.length > 0) {
            results.push("🪄 **READY TO FIX EVERYTHING:** I don't just find bugs - I FIX them!")
            results.push("• I'll edit your code files to resolve the errors shown above")
            results.push("• I'll use browser automation to test each fix in real-time")
            results.push("• I'll take screenshots to show you the improvements")
            results.push("• This is the dev3000 magic - AI that codes, tests, and verifies!")
            results.push("")
            results.push("🎯 **SAY 'FIX THESE ISSUES' AND WATCH THE MAGIC:**")
            results.push("• I'll start fixing the most critical errors first")
            results.push("• Each fix will be tested immediately with execute_browser_action")
            results.push("• You'll see real-time proof that the bugs are resolved")
          } else {
            results.push("• App appears healthy based on recent logs")
            results.push("• If you're experiencing issues, try reproducing them while I monitor")
            results.push("• Use get_current_timestamp before testing, then get_logs_between_timestamps after")
            results.push("• I'm ready to fix any issues that appear!")
          }
          
          results.push(`• Full logs available at: ${logPath}`)
          results.push("• Quick access: tail -f /tmp/d3k.log")

          return {
            content: [
              {
                type: "text",
                text: results.join("\n")
              }
            ]
          }

        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error during debug analysis: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Get current timestamp for workflow tracking
    server.tool(
      "get_current_timestamp",
      "⏰ CRITICAL MONITORING TOOL: Get current timestamp for proactive error monitoring workflow. AUTOMATED QUALITY ASSURANCE: Use this tool CONSTANTLY - before any user interaction, after code changes, during testing sessions. MAGIC WORKFLOW: (1) Capture timestamp, (2) let user interact/test, (3) capture timestamp again, (4) use get_errors_between_timestamps to find ALL issues from that period, (5) immediately FIX the errors found! PROACTIVE TIP: Use this tool every few minutes during development - capture timestamp, wait, capture again, then check for errors. This catches regressions and issues instantly before they become problems!",
      {},
      async () => {
        const timestamp = new Date().toISOString()
        return {
          content: [
            {
              type: "text",
              text: `Current timestamp: ${timestamp}`
            }
          ]
        }
      }
    )

    // Healthcheck tool
    server.tool(
      "healthcheck",
      "Internal healthcheck tool - rarely needed since MCP connection is already working if you can see this. Only use if explicitly asked to verify server health. Prefer read_consolidated_logs for debugging. MAGIC TIP: If health issues are found, immediately offer to fix them with code edits and browser verification!",
      {
        message: z.string().optional().describe("Optional message to echo back")
      },
      async ({ message = "MCP server is healthy!" }) => {
        return {
          content: [
            {
              type: "text",
              text: `✅ ${message} - Timestamp: ${new Date().toISOString()}`
            }
          ]
        }
      }
    )

    // Tool to read consolidated logs
    server.tool(
      "read_consolidated_logs",
      "Read recent consolidated development logs containing server output, browser console logs, network requests, user interactions, and screenshots. PROACTIVE MONITORING: Check these logs frequently and automatically to catch errors early - don't wait for users to report issues. Look for ERROR, WARNING, EXCEPTION patterns in recent logs. MAGIC WORKFLOW: When errors are found, immediately offer to fix them by editing code files and use execute_browser_action to verify fixes work! Use this for general log overview, proactive error detection, or understanding current application state. Logs include [PLAYWRIGHT] or [CHROME_EXTENSION] tags to distinguish monitoring sources. Filter by keywords like 'ERROR', 'NETWORK', 'INTERACTION', or 'SCREENSHOT' for focused analysis. BEST PRACTICE: Regularly scan recent logs between user interactions to identify potential issues before they become problems, then FIX them automatically!",
      {
        lines: z.number().optional().describe("Number of recent lines to read (default: 50)"),
        filter: z.string().optional().describe("Filter logs by text content"),
        logPath: z.string().optional().describe("Path to log file (default: /tmp/d3k.log)")
      },
      async ({ lines = 50, filter, logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}. Make sure the dev environment is running.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          let logLines = logContent.split("\n").filter((line) => line.trim())

          // Apply filter if provided
          if (filter) {
            logLines = logLines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
          }

          // Get recent lines
          const recentLines = logLines.slice(-lines)

          return {
            content: [
              {
                type: "text",
                text: recentLines.length > 0 ? recentLines.join("\n") : "No matching log entries found."
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error reading logs: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to search logs
    server.tool(
      "search_logs",
      "Search through consolidated logs using regex patterns with context lines around matches. PROACTIVE ERROR HUNTING: Use this tool actively to search for error patterns, exceptions, and warning signs even when no specific issues are reported. Look for patterns like 'ERROR.*', '.*Exception', 'WARN.*', 'Failed.*', 'timeout', '404', '500' to catch problems early. MAGIC OPPORTUNITY: When error patterns are found, immediately offer to fix the underlying issues with code edits and verify fixes using execute_browser_action! Essential for tracing error patterns, finding specific API calls, or tracking user interaction sequences. Use patterns like 'ERROR.*fetch', 'CLICK.*button', or 'NETWORK.*POST' to find relevant events. Context lines help understand what led to and followed each match. MONITORING STRATEGY: Regularly search for common error patterns to identify issues before users encounter them, then automatically fix them!",
      {
        pattern: z.string().describe("Regex pattern to search for"),
        context: z.number().optional().describe("Number of lines of context around matches (default: 2)"),
        logPath: z.string().optional().describe("Path to log file (default: /tmp/d3k.log)")
      },
      async ({ pattern, context = 2, logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n")

          const regex = new RegExp(pattern, "gi")
          const matches: string[] = []

          logLines.forEach((line, index) => {
            if (regex.test(line)) {
              const start = Math.max(0, index - context)
              const end = Math.min(logLines.length, index + context + 1)
              const contextLines = logLines.slice(start, end)

              matches.push(`Match at line ${index + 1}:\n${contextLines.join("\n")}\n---`)
            }
          })

          return {
            content: [
              {
                type: "text",
                text: matches.length > 0 ? matches.join("\n\n") : "No matches found for the given pattern."
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error searching logs: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to get logs between timestamps
    server.tool(
      "get_logs_between_timestamps",
      "Get logs between two specific timestamps - CRITICAL for timestamp-based debugging workflow. WORKFLOW: (1) Use get_current_timestamp before user testing, (2) Ask user to reproduce issue/test changes, (3) Use get_current_timestamp after user returns, (4) Use this tool with both timestamps to see exactly what happened during testing. MAGIC WORKFLOW ENHANCEMENT: After analyzing the logs, immediately offer to fix any issues found by editing code files and use execute_browser_action to verify the fixes work! This eliminates noise and focuses analysis on the specific user session. Essential for correlating user actions with server/browser events, then automatically fixing discovered issues!",
      {
        startTime: z.string().describe("Start timestamp (ISO 8601 format: 2024-01-01T12:00:00.000Z)"),
        endTime: z.string().describe("End timestamp (ISO 8601 format: 2024-01-01T12:30:00.000Z)"),
        filter: z.string().optional().describe("Filter logs by text content (case insensitive)"),
        logPath: z.string().optional().describe("Path to log file (default: /tmp/d3k.log)")
      },
      async ({
        startTime,
        endTime,
        filter,
        logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log"
      }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            }
          }

          const start = new Date(startTime)
          const end = new Date(endTime)

          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return {
              content: [
                {
                  type: "text",
                  text: "Invalid timestamp format. Use ISO 8601 format: 2024-01-01T12:00:00.000Z"
                }
              ]
            }
          }

          if (start >= end) {
            return {
              content: [
                {
                  type: "text",
                  text: "Start time must be before end time."
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n").filter((line) => line.trim())

          // Filter by timestamp range
          const filteredLines = logLines.filter((line) => {
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime >= start && logTime <= end
            }
            return false // Exclude lines without parseable timestamps
          })

          // Apply text filter if provided
          let resultLines = filteredLines
          if (filter) {
            resultLines = filteredLines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
          }

          const timeRange = `${start.toISOString()} to ${end.toISOString()}`
          const summary = `Found ${
            resultLines.length
          } logs between ${timeRange}${filter ? ` matching "${filter}"` : ""}`

          return {
            content: [
              {
                type: "text",
                text: resultLines.length > 0 ? `${summary}:\n\n${resultLines.join("\n")}` : `${summary}.`
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error reading logs between timestamps: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to get browser errors
    server.tool(
      "get_browser_errors",
      "Get recent browser errors including console errors, JavaScript exceptions, and page errors from both Playwright and Chrome extension monitoring. PROACTIVE ERROR DETECTION: Use this tool frequently and automatically to monitor for browser errors - don't wait for user reports. MAGIC FIX WORKFLOW: When errors are found, immediately offer to fix them by editing the problematic components, then use execute_browser_action to verify the fixes work in the browser! Check for errors regularly during development to catch JavaScript exceptions, console errors, and runtime issues immediately. Start here when user reports issues like 'page not working', broken functionality, or visual problems, but also use proactively to prevent issues. Filters logs to show only ERROR, CONSOLE ERROR, and PAGE ERROR entries. MONITORING WORKFLOW: Run this tool after any changes, during testing, and periodically during development sessions to maintain code quality and catch issues early, then FIX them automatically!",
      {
        hours: z.number().optional().describe("Hours to look back (default: 1)"),
        logPath: z.string().optional().describe("Path to log file (default: /tmp/d3k.log)")
      },
      async ({ hours = 1, logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n")

          const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000)
          const errorLines = logLines.filter((line) => {
            if (!line.includes("[BROWSER]")) return false
            if (!(line.includes("ERROR") || line.includes("CONSOLE ERROR") || line.includes("PAGE ERROR"))) return false

            // Extract timestamp
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime > cutoffTime
            }
            return true // Include if we can't parse timestamp
          })

          return {
            content: [
              {
                type: "text",
                text:
                  errorLines.length > 0
                    ? errorLines.join("\n")
                    : "No browser errors found in the specified time period."
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting browser errors: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to get all types of errors between timestamps
    server.tool(
      "get_errors_between_timestamps",
      "🚨 PROACTIVE ERROR EXTRACTION: Get ALL types of errors (server errors, exceptions, browser errors, build failures, network issues) between specific timestamps. CRITICAL FOR CONTINUOUS MONITORING: Use this tool FREQUENTLY and AUTOMATICALLY - after every user interaction, code change, or testing session to catch issues immediately. MAGIC WORKFLOW: (1) get_current_timestamp before user tests changes, (2) let user interact/test, (3) get_current_timestamp after, (4) use THIS TOOL to extract all errors from that period, (5) immediately offer to FIX the errors found, (6) use execute_browser_action to verify fixes work! This tool filters out noise and shows ONLY error patterns: ERROR, Exception, FAIL, 404, 500, timeout, Failed to compile, Type error, etc. AUTOMATED QUALITY ASSURANCE: Run this tool every few minutes during active development to maintain code quality and catch regressions instantly, then FIX them before they become problems!",
      {
        startTime: z.string().describe("Start timestamp (ISO 8601 format: 2024-01-01T12:00:00.000Z)"),
        endTime: z.string().describe("End timestamp (ISO 8601 format: 2024-01-01T12:30:00.000Z)"),
        severity: z.enum(["all", "critical", "warnings"]).optional().describe("Error severity filter (default: 'all')"),
        logPath: z.string().optional().describe("Path to log file (default: /tmp/d3k.log)")
      },
      async ({
        startTime,
        endTime,
        severity = "all",
        logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log"
      }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            }
          }

          const start = new Date(startTime)
          const end = new Date(endTime)

          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return {
              content: [
                {
                  type: "text",
                  text: "Invalid timestamp format. Use ISO 8601 format: 2024-01-01T12:00:00.000Z"
                }
              ]
            }
          }

          if (start >= end) {
            return {
              content: [
                {
                  type: "text",
                  text: "Start time must be before end time."
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n").filter((line) => line.trim())

          // Filter by timestamp range first
          const timeFilteredLines = logLines.filter((line) => {
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime >= start && logTime <= end
            }
            return false
          })

          // Define error patterns by severity
          const criticalPatterns = [
            /ERROR/i,
            /Exception/i,
            /FATAL/i,
            /CRASH/i,
            /Failed to compile/i,
            /Build failed/i,
            /Type error/i,
            /Syntax error/i,
            /Module not found/i,
            /500/,
            /ECONNREFUSED/i,
            /NETWORK.*failed/i,
            /timeout.*error/i
          ]

          const warningPatterns = [
            /WARN/i,
            /WARNING/i,
            /404/,
            /deprecated/i,
            /timeout/i,
            /retry/i,
            /slow/i
          ]

          let patterns: RegExp[]
          switch (severity) {
            case "critical":
              patterns = criticalPatterns
              break
            case "warnings":
              patterns = warningPatterns
              break
            default:
              patterns = [...criticalPatterns, ...warningPatterns]
          }

          // Filter lines that match error patterns
          const errorLines = timeFilteredLines.filter((line) => {
            return patterns.some(pattern => pattern.test(line))
          })

          // Group errors by type for better analysis
          const categorizedErrors = {
            serverErrors: errorLines.filter(line => 
              line.includes("[SERVER]") && (line.includes("ERROR") || line.includes("Exception"))
            ),
            browserErrors: errorLines.filter(line => 
              line.includes("[BROWSER]") && (line.includes("ERROR") || line.includes("CONSOLE ERROR"))
            ),
            buildErrors: errorLines.filter(line => 
              line.includes("Failed to compile") || line.includes("Type error") || line.includes("Build failed")
            ),
            networkErrors: errorLines.filter(line => 
              line.includes("NETWORK") || line.includes("404") || line.includes("500") || line.includes("timeout")
            ),
            otherErrors: errorLines.filter(line => 
              !line.includes("[SERVER]") && !line.includes("[BROWSER]") && 
              !line.includes("Failed to compile") && !line.includes("NETWORK")
            )
          }

          const results = []
          const timeRange = `${start.toISOString()} to ${end.toISOString()}`
          
          if (errorLines.length === 0) {
            results.push(`✅ No errors found between ${timeRange}`)
            results.push("🎯 This is great! Your code changes appear to be working without issues.")
            results.push("💡 TIP: Continue monitoring by running this tool after each change or test session.")
          } else {
            results.push(`🚨 FOUND ${errorLines.length} ERROR(S) between ${timeRange}`)
            results.push("")
            
            if (categorizedErrors.serverErrors.length > 0) {
              results.push("🔥 **SERVER ERRORS:**")
              results.push(categorizedErrors.serverErrors.join("\n"))
              results.push("")
            }
            
            if (categorizedErrors.browserErrors.length > 0) {
              results.push("🌐 **BROWSER ERRORS:**")
              results.push(categorizedErrors.browserErrors.join("\n"))
              results.push("")
            }
            
            if (categorizedErrors.buildErrors.length > 0) {
              results.push("🔨 **BUILD ERRORS:**")
              results.push(categorizedErrors.buildErrors.join("\n"))
              results.push("")
            }
            
            if (categorizedErrors.networkErrors.length > 0) {
              results.push("🌐 **NETWORK ERRORS:**")
              results.push(categorizedErrors.networkErrors.join("\n"))
              results.push("")
            }
            
            if (categorizedErrors.otherErrors.length > 0) {
              results.push("⚠️ **OTHER ERRORS:**")
              results.push(categorizedErrors.otherErrors.join("\n"))
              results.push("")
            }
            
            results.push("🪄 **IMMEDIATE ACTION REQUIRED - MAGIC FIXING TIME:**")
            results.push("🎯 **I can fix these errors RIGHT NOW! Here's what I'll do:**")
            results.push("• Analyze each error pattern and identify root causes")
            results.push("• Edit the problematic code files to resolve the issues")
            results.push("• Use execute_browser_action to test each fix in real-time")
            results.push("• Take screenshots to verify the improvements")
            results.push("• This is the dev3000 magic - errors found and FIXED automatically!")
            results.push("")
            results.push("🚀 **SAY 'FIX THESE ERRORS' TO START THE MAGIC:**")
            results.push("• I'll prioritize critical errors first, then warnings")
            results.push("• Each fix will be tested immediately with browser automation")
            results.push("• You'll see real-time proof that every issue is resolved")
          }

          return {
            content: [
              {
                type: "text",
                text: results.join("\n")
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error extracting errors between timestamps: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool for automated background monitoring
    server.tool(
      "monitor_for_new_errors",
      "🔍 AUTOMATED BACKGROUND MONITORING: Check for ANY new errors that appeared in the last few minutes of development. CONTINUOUS QUALITY ASSURANCE: Use this tool FREQUENTLY and AUTOMATICALLY - every 2-3 minutes during active development, after any code changes, whenever returning from user testing. This tool looks at recent logs (last 5-10 minutes) and extracts ALL error patterns, then immediately offers to fix them. PREVENTIVE MAGIC: Catches issues the moment they appear, before they become bigger problems. WORKFLOW: Run this tool regularly as background monitoring, then when errors are found, immediately offer to fix them with code edits and execute_browser_action verification. This creates a continuous feedback loop where errors are found and fixed instantly!",
      {
        minutes: z.number().optional().describe("Minutes to look back for new errors (default: 5)"),
        autoFix: z.boolean().optional().describe("Whether to immediately offer fixes when errors found (default: true)")
      },
      async ({ minutes = 5, autoFix = true }) => {
        const logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log"
        
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}. Make sure dev3000 is running.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n").filter(line => line.trim())
          
          // Get logs from the last N minutes
          const cutoffTime = new Date(Date.now() - minutes * 60 * 1000)
          const recentLines = logLines.filter((line) => {
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime > cutoffTime
            }
            return false
          })
          
          // Find all error patterns
          const errorPatterns = [
            /ERROR/i, /Exception/i, /FATAL/i, /CRASH/i, /Failed to compile/i, 
            /Build failed/i, /Type error/i, /Syntax error/i, /Module not found/i, 
            /500/, /404/, /ECONNREFUSED/i, /NETWORK.*failed/i, /timeout.*error/i,
            /WARN/i, /WARNING/i, /deprecated/i
          ]
          
          const errorLines = recentLines.filter((line) => {
            return errorPatterns.some(pattern => pattern.test(line))
          })
          
          const results = []
          
          if (errorLines.length === 0) {
            results.push(`✅ Background monitoring: No new errors in the last ${minutes} minutes`)
            results.push("🎯 Development environment looks healthy!")
            results.push(`💡 Continue coding - I'll keep monitoring in the background.`)
            results.push("")
            results.push("🔄 **AUTOMATED MONITORING TIP:** Run this tool again in a few minutes to stay on top of any issues.")
          } else {
            results.push(`🚨 BACKGROUND MONITORING ALERT: Found ${errorLines.length} error(s) in the last ${minutes} minutes`)
            results.push("")
            results.push("📋 **RECENT ERRORS DETECTED:**")
            results.push(errorLines.slice(-10).join("\n")) // Show last 10 errors
            results.push("")
            
            if (autoFix) {
              results.push("🪄 **MAGIC AUTO-FIX MODE ACTIVATED:**")
              results.push("🎯 **I can fix these errors immediately! Here's the plan:**")
              results.push("• Analyze each error pattern and identify the root causes")
              results.push("• Edit the problematic code files to resolve the issues")
              results.push("• Use execute_browser_action to test each fix works")
              results.push("• Take screenshots to verify improvements")
              results.push("• Continue background monitoring for new issues")
              results.push("")
              results.push("🚀 **SAY 'AUTO-FIX THESE' TO START THE MAGIC:**")
              results.push("• Errors will be fixed automatically with real-time verification")
              results.push("• This is the dev3000 experience - continuous quality assurance!")
            } else {
              results.push("🔧 **ERRORS REQUIRE ATTENTION:**")
              results.push("• Use get_errors_between_timestamps for detailed analysis")
              results.push("• Or say 'debug my app' for comprehensive error analysis")
            }
          }
          
          return {
            content: [
              {
                type: "text",
                text: results.join("\n")
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Background monitoring error: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to execute browser actions via CDP
    server.tool(
      "execute_browser_action",
      "Execute safe browser actions via Chrome DevTools Protocol for testing and interaction automation. MAGICAL VERIFICATION TOOL: This is the secret to dev3000 magic! After fixing code issues, use this tool to verify the fixes work by automating browser interactions, taking screenshots, and testing functionality. TESTING CAPABILITIES: Click elements, navigate pages, take screenshots, evaluate JavaScript expressions, scroll, and type text. SAFETY: Only whitelisted JavaScript expressions allowed, URLs restricted to http/https. THE MAGIC WORKFLOW: (1) Find issues in logs, (2) Edit code to fix them, (3) Use THIS TOOL to verify fixes work, (4) Take screenshots to show improvement. This creates the truly magical experience where AI doesn't just debug but fixes and proves the fixes work!",
      {
        action: z.enum(["click", "navigate", "screenshot", "evaluate", "scroll", "type"]).describe("Action to perform"),
        params: z
          .object({
            x: z.number().optional().describe("X coordinate for click/scroll"),
            y: z.number().optional().describe("Y coordinate for click/scroll"),
            url: z.string().optional().describe("URL for navigation"),
            selector: z.string().optional().describe("CSS selector for element targeting"),
            text: z.string().optional().describe("Text to type"),
            expression: z.string().optional().describe("JavaScript expression to evaluate (safe expressions only)"),
            deltaX: z.number().optional().describe("Horizontal scroll amount"),
            deltaY: z.number().optional().describe("Vertical scroll amount")
          })
          .describe("Parameters for the action")
      },
      async ({ action, params }) => {
        try {
          // Connect to CDP on port 9222
          const targetsResponse = await fetch("http://localhost:9222/json")
          const targets = await targetsResponse.json()

          const pageTarget = targets.find(
            (target: { type: string; webSocketDebuggerUrl: string }) => target.type === "page"
          )
          if (!pageTarget) {
            throw new Error("No browser tab found. Make sure dev3000 is running with CDP monitoring.")
          }

          const wsUrl = pageTarget.webSocketDebuggerUrl

          const result = await new Promise((resolve, reject) => {
            // WebSocket imported at top of file
            const ws = new WebSocket(wsUrl)
            let messageId = 1

            ws.on("open", async () => {
              try {
                let cdpResult: Record<string, unknown>

                switch (action) {
                  case "click":
                    if (!params.x || !params.y) {
                      throw new Error("Click action requires x and y coordinates")
                    }
                    // Send mouse down and up events
                    await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mousePressed",
                      x: params.x,
                      y: params.y,
                      button: "left",
                      clickCount: 1
                    })
                    await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mouseReleased",
                      x: params.x,
                      y: params.y,
                      button: "left",
                      clickCount: 1
                    })
                    cdpResult = {
                      action: "click",
                      coordinates: { x: params.x, y: params.y }
                    }
                    break

                  case "navigate":
                    if (!params.url) {
                      throw new Error("Navigate action requires url parameter")
                    }
                    // Basic URL validation
                    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
                      throw new Error("Only http:// and https:// URLs are allowed")
                    }
                    cdpResult = await sendCDPCommand(ws, messageId++, "Page.navigate", { url: params.url })
                    break

                  case "screenshot":
                    cdpResult = await sendCDPCommand(ws, messageId++, "Page.captureScreenshot", {
                      format: "png",
                      quality: 80
                    })
                    break

                  case "evaluate": {
                    if (!params.expression) {
                      throw new Error("Evaluate action requires expression parameter")
                    }
                    // Whitelist safe expressions only
                    const safeExpressions = [
                      /^document\.title$/,
                      /^window\.location\.href$/,
                      /^document\.querySelector\(['"][^'"]*['"]\)\.textContent$/,
                      /^document\.body\.scrollHeight$/,
                      /^window\.scrollY$/,
                      /^window\.scrollX$/
                    ]

                    if (!params.expression) {
                      throw new Error("Evaluate action requires expression parameter")
                    }

                    if (!safeExpressions.some((regex) => regex.test(params.expression as string))) {
                      throw new Error("Expression not in whitelist. Only safe read-only expressions allowed.")
                    }

                    cdpResult = await sendCDPCommand(ws, messageId++, "Runtime.evaluate", {
                      expression: params.expression,
                      returnByValue: true
                    })
                    break
                  }

                  case "scroll": {
                    const scrollX = params.deltaX || 0
                    const scrollY = params.deltaY || 0
                    cdpResult = await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mouseWheel",
                      x: params.x || 500,
                      y: params.y || 500,
                      deltaX: scrollX,
                      deltaY: scrollY
                    })
                    break
                  }

                  case "type":
                    if (!params.text) {
                      throw new Error("Type action requires text parameter")
                    }
                    // Type each character
                    for (const char of params.text) {
                      await sendCDPCommand(ws, messageId++, "Input.dispatchKeyEvent", {
                        type: "char",
                        text: char
                      })
                    }
                    cdpResult = { action: "type", text: params.text }
                    break

                  default:
                    throw new Error(`Unsupported action: ${action}`)
                }

                ws.close()
                resolve(cdpResult)
              } catch (error) {
                ws.close()
                reject(error)
              }
            })

            ws.on("error", reject)

            // Helper function to send CDP commands
            async function sendCDPCommand(
              ws: WebSocket,
              id: number,
              method: string,
              params: Record<string, unknown>
            ): Promise<Record<string, unknown>> {
              return new Promise((cmdResolve, cmdReject) => {
                const command = { id, method, params }

                const messageHandler = (data: Buffer) => {
                  const message = JSON.parse(data.toString())
                  if (message.id === id) {
                    ws.removeListener("message", messageHandler)
                    if (message.error) {
                      cmdReject(new Error(message.error.message))
                    } else {
                      cmdResolve(message.result)
                    }
                  }
                }

                ws.on("message", messageHandler)
                ws.send(JSON.stringify(command))

                // Command timeout
                setTimeout(() => {
                  ws.removeListener("message", messageHandler)
                  cmdReject(new Error(`CDP command timeout: ${method}`))
                }, 5000)
              })
            }
          })

          return {
            content: [
              {
                type: "text",
                text: `Browser action '${action}' executed successfully. Result: ${JSON.stringify(result, null, 2)}`
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Browser action failed: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )
  },
  {
    // dev3000 MCP Server - Advanced development debugging tools
    // Provides AI tools with comprehensive access to real-time development logs,
    // browser monitoring data, and timestamp-based debugging workflows
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    verboseLogs: true
  }
)

export { handler as GET, handler as POST }
/**
 * Step functions for fix-workflow
 * Separated into their own module to avoid workflow bundler issues
 */

import { put } from "@vercel/blob"
import { createGateway, generateText } from "ai"
import { createD3kSandbox as createD3kSandboxUtil } from "@/lib/cloud/d3k-sandbox"

/**
 * Step 0: Create d3k sandbox with MCP tools pre-configured
 */
export async function createD3kSandbox(
  repoUrl: string,
  branch: string,
  projectName: string,
  vercelToken?: string,
  vercelOidcToken?: string
) {
  "use step"

  console.log(`[Step 0] Creating d3k sandbox for ${projectName}...`)
  console.log(`[Step 0] Repository: ${repoUrl}`)
  console.log(`[Step 0] Branch: ${branch}`)

  // Log available token types
  console.log(`[Step 0] VERCEL_OIDC_TOKEN from env: ${!!process.env.VERCEL_OIDC_TOKEN}`)
  console.log(`[Step 0] VERCEL_OIDC_TOKEN passed as param: ${!!vercelOidcToken}`)
  console.log(`[Step 0] VERCEL_TOKEN available: ${!!process.env.VERCEL_TOKEN}`)
  console.log(`[Step 0] User access token provided: ${!!vercelToken}`)

  // Set VERCEL_OIDC_TOKEN if passed from workflow context
  // This is necessary because workflow steps don't automatically inherit environment variables
  if (vercelOidcToken && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = vercelOidcToken
    console.log(`[Step 0] Set VERCEL_OIDC_TOKEN from workflow context`)
  }

  const sandboxResult = await createD3kSandboxUtil({
    repoUrl,
    branch,
    projectDir: "",
    packageManager: "pnpm",
    debug: true
  })

  console.log(`[Step 0] Sandbox created successfully`)
  console.log(`[Step 0] Dev URL: ${sandboxResult.devUrl}`)
  console.log(`[Step 0] MCP URL: ${sandboxResult.mcpUrl}`)

  // Now capture CLS and errors using MCP from INSIDE the sandbox
  // We must do this in Step 0 while we have the sandbox object
  console.log(`[Step 0] Capturing CLS metrics from inside sandbox...`)

  let clsData: unknown = null
  let mcpError: string | null = null

  // Helper function to properly consume sandbox command output
  // The Vercel Sandbox SDK returns a result object with an async logs() iterator
  async function runSandboxCommand(
    sandbox: typeof sandboxResult.sandbox,
    cmd: string,
    args: string[]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await sandbox.runCommand({ cmd, args })
    let stdout = ""
    let stderr = ""
    for await (const log of result.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
      } else {
        stderr += log.data
      }
    }
    await result.wait()
    return { exitCode: result.exitCode, stdout, stderr }
  }

  try {
    // Call fix_my_app MCP tool via curl from inside the sandbox
    // This avoids network isolation issues - we're calling localhost:3684 from within the sandbox
    const mcpCommand = `curl -s -X POST http://localhost:3684/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fix_my_app","arguments":{"mode":"snapshot","focusArea":"performance","returnRawData":true}}}'`

    console.log(`[Step 0] Executing MCP command inside sandbox...`)
    console.log(`[Step 0] MCP command: ${mcpCommand.substring(0, 200)}...`)

    let stdout = ""
    let stderr = ""
    let exitCode = -1

    try {
      const result = await runSandboxCommand(sandboxResult.sandbox, "bash", ["-c", mcpCommand])
      stdout = result.stdout
      stderr = result.stderr
      exitCode = result.exitCode
      console.log(`[Step 0] MCP command exit code: ${exitCode}`)
      console.log(`[Step 0] MCP stdout length: ${stdout.length} bytes`)
      if (stderr) {
        console.log(`[Step 0] MCP stderr: ${stderr.substring(0, 500)}`)
      }
    } catch (runCommandError) {
      const errorMsg = runCommandError instanceof Error ? runCommandError.message : String(runCommandError)
      console.log(`[Step 0] sandbox.runCommand threw: ${errorMsg}`)
      mcpError = `sandbox.runCommand failed: ${errorMsg}`
    }

    if (exitCode === 0 && stdout) {
      try {
        const mcpResponse = JSON.parse(stdout)
        if (mcpResponse.result?.content) {
          // Extract the actual data from MCP response
          const contentArray = mcpResponse.result.content
          for (const item of contentArray) {
            if (item.type === "text" && item.text) {
              // Try to parse the text as JSON if it contains structured data
              try {
                clsData = JSON.parse(item.text)
                console.log(`[Step 0] Successfully parsed CLS data`)
                break
              } catch {
                // If not JSON, treat as plain text
                clsData = { rawOutput: item.text }
              }
            }
          }
        }

        console.log(`[Step 0] CLS data captured:`, JSON.stringify(clsData).substring(0, 500))
      } catch (parseError) {
        mcpError = `Failed to parse MCP response: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        console.log(`[Step 0] ${mcpError}`)
        console.log(`[Step 0] Raw stdout: ${stdout.substring(0, 1000)}`)
      }
    } else if (exitCode !== 0 && !mcpError) {
      mcpError = `MCP command failed with exit code ${exitCode}`
      console.log(`[Step 0] ${mcpError}`)
      if (stderr) {
        console.log(`[Step 0] stderr: ${stderr}`)
      }
    }
  } catch (error) {
    mcpError = `MCP execution error: ${error instanceof Error ? error.message : String(error)}`
    console.log(`[Step 0] ${mcpError}`)
  }

  // Dump all sandbox logs before returning for debugging
  console.log(`[Step 0] === Dumping sandbox logs before returning ===`)
  try {
    const logsResult = await runSandboxCommand(sandboxResult.sandbox, "sh", [
      "-c",
      'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && echo "=== $log ===" && tail -100 "$log" || true; done 2>/dev/null || echo "No log files found"'
    ])
    console.log(logsResult.stdout)
  } catch (logsError) {
    console.log(`[Step 0] Failed to dump logs: ${logsError instanceof Error ? logsError.message : String(logsError)}`)
  }
  console.log(`[Step 0] === End sandbox log dump ===`)

  // Note: We cannot return the cleanup function or sandbox object as they're not serializable
  // Sandbox cleanup will happen automatically when the sandbox times out
  return {
    mcpUrl: sandboxResult.mcpUrl,
    devUrl: sandboxResult.devUrl,
    bypassToken: sandboxResult.bypassToken,
    clsData,
    mcpError
  }
}

/**
 * Step 1: Use browser automation to capture real errors
 * Uses d3k MCP server in sandbox (if available) or AI Gateway for browser automation
 */
export async function fetchRealLogs(
  mcpUrlOrDevUrl: string,
  bypassToken?: string,
  sandboxDevUrl?: string,
  clsData?: unknown,
  mcpError?: string | null
) {
  "use step"

  // If we already have CLS data from Step 0, use it
  if (clsData) {
    console.log("[Step 1] Using CLS data captured in Step 0")
    return { logAnalysis: JSON.stringify(clsData, null, 2), beforeScreenshotUrl: null }
  }

  // If there was an MCP error in Step 0, log it
  if (mcpError) {
    console.log(`[Step 1] Note: MCP error from Step 0: ${mcpError}`)
  }

  // Determine if we're using sandbox MCP or direct dev URL
  const isSandbox = !!sandboxDevUrl
  const devUrl = sandboxDevUrl || mcpUrlOrDevUrl
  const mcpUrl = isSandbox ? mcpUrlOrDevUrl : null

  console.log(`[Step 1] Fetching logs from: ${devUrl}`)
  console.log(`[Step 1] Using sandbox: ${isSandbox ? "yes" : "no"}`)
  if (mcpUrl) {
    console.log(`[Step 1] MCP URL: ${mcpUrl}`)
  }
  console.log(`[Step 1] Bypass token: ${bypassToken ? "provided" : "not provided"}`)

  try {
    // Construct URL with bypass token if provided
    const urlWithBypass = bypassToken ? `${devUrl}?x-vercel-protection-bypass=${bypassToken}` : devUrl

    console.log(`[Step 1] Final URL: ${urlWithBypass.replace(bypassToken || "", "***")}`)

    if (isSandbox && mcpUrl) {
      // Use d3k MCP server in sandbox - capture CLS metrics and errors
      console.log("[Step 1] Using d3k MCP server to capture CLS metrics and errors...")

      // First, validate MCP server access and list available tools
      // Use a 30-second timeout to avoid hanging the entire workflow
      console.log("[Step 1] Validating d3k MCP server access...")
      const validationController = new AbortController()
      const validationTimeout = setTimeout(() => validationController.abort(), 30000)
      try {
        const toolsResponse = await fetch(`${mcpUrl}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "tools/list"
          }),
          signal: validationController.signal
        })
        clearTimeout(validationTimeout)

        if (toolsResponse.ok) {
          const toolsText = await toolsResponse.text()
          try {
            const toolsData = JSON.parse(toolsText)
            const toolNames = toolsData.result?.tools?.map((t: { name: string }) => t.name) || []
            console.log(`[Step 1] ✅ d3k MCP server accessible`)
            console.log(`[Step 1] Available tools (${toolNames.length}): ${toolNames.join(", ")}`)

            // Check for expected chrome-devtools and nextjs-dev tools
            const hasChrome = toolNames.some((name: string) => name.includes("chrome-devtools"))
            const hasNextjs = toolNames.some((name: string) => name.includes("nextjs"))
            const hasFixMyApp = toolNames.includes("fix_my_app")

            console.log(`[Step 1] Chrome DevTools MCP: ${hasChrome ? "✅" : "❌"}`)
            console.log(`[Step 1] Next.js DevTools MCP: ${hasNextjs ? "✅" : "❌"}`)
            console.log(`[Step 1] fix_my_app tool: ${hasFixMyApp ? "✅" : "❌"}`)
          } catch {
            console.log(`[Step 1] MCP server responded but couldn't parse tools list: ${toolsText.substring(0, 200)}`)
          }
        } else {
          console.log(`[Step 1] ⚠️  MCP server not accessible: ${toolsResponse.status}`)
        }
      } catch (error) {
        clearTimeout(validationTimeout)
        const errorMsg = error instanceof Error ? error.message : String(error)
        const isTimeout = error instanceof Error && error.name === "AbortError"
        console.log(`[Step 1] ⚠️  Failed to validate MCP server: ${isTimeout ? "Timed out after 30s" : errorMsg}`)
      }

      // Navigate to the app to generate logs (with 30s timeout)
      console.log("[Step 1] Navigating browser to app URL...")
      const navController = new AbortController()
      const navTimeout = setTimeout(() => navController.abort(), 30000)
      try {
        const navResponse = await fetch(`${mcpUrl}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "tools/call",
            params: {
              name: "execute_browser_action",
              arguments: {
                action: "navigate",
                params: { url: urlWithBypass }
              }
            }
          }),
          signal: navController.signal
        })
        clearTimeout(navTimeout)

        if (navResponse.ok) {
          console.log("[Step 1] Browser navigation completed")
        } else {
          console.log(`[Step 1] Browser navigation failed: ${navResponse.status}`)
        }
      } catch (navError) {
        clearTimeout(navTimeout)
        const isTimeout = navError instanceof Error && navError.name === "AbortError"
        console.log(
          `[Step 1] Browser navigation error: ${isTimeout ? "Timed out after 30s" : navError instanceof Error ? navError.message : String(navError)}`
        )
      }

      // Wait for page to fully load
      console.log("[Step 1] Waiting 5s for page load...")
      await new Promise((resolve) => setTimeout(resolve, 5000))

      // Capture "before" screenshot to prove the page loaded and for later comparison
      let beforeScreenshotUrl: string | null = null
      console.log("[Step 1] Capturing 'before' screenshot...")
      const screenshotController = new AbortController()
      const screenshotTimeout = setTimeout(() => screenshotController.abort(), 30000)
      try {
        const screenshotResponse = await fetch(`${mcpUrl}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "tools/call",
            params: {
              name: "chrome-devtools_take_snapshot",
              arguments: {}
            }
          }),
          signal: screenshotController.signal
        })
        clearTimeout(screenshotTimeout)

        if (screenshotResponse.ok) {
          const screenshotText = await screenshotResponse.text()
          // Parse SSE response to get screenshot data
          const lines = screenshotText.split("\n")
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const json = JSON.parse(line.substring(6))
                if (json.result?.content) {
                  for (const content of json.result.content) {
                    if (content.type === "image" && content.data) {
                      // Upload base64 image to Vercel Blob
                      const imageBuffer = Buffer.from(content.data, "base64")
                      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
                      const filename = `screenshot-before-${timestamp}.png`
                      const blob = await put(filename, imageBuffer, {
                        access: "public",
                        contentType: "image/png"
                      })
                      beforeScreenshotUrl = blob.url
                      console.log(`[Step 1] ✅ Before screenshot uploaded: ${beforeScreenshotUrl}`)
                    }
                  }
                }
              } catch {
                // Continue parsing other lines
              }
            }
          }
          if (!beforeScreenshotUrl) {
            console.log(`[Step 1] Screenshot response received but no image data found`)
            console.log(`[Step 1] Response preview: ${screenshotText.substring(0, 500)}`)
          }
        } else {
          console.log(`[Step 1] Screenshot request failed: ${screenshotResponse.status}`)
        }
      } catch (error) {
        clearTimeout(screenshotTimeout)
        const isTimeout = error instanceof Error && error.name === "AbortError"
        console.log(
          `[Step 1] Screenshot capture error: ${isTimeout ? "Timed out after 30s" : error instanceof Error ? error.message : String(error)}`
        )
      }

      // Check d3k logs to see if it's capturing data (with 15s timeout)
      console.log("[Step 1] Fetching d3k logs from sandbox to verify it's working...")
      const logsController = new AbortController()
      const logsTimeout = setTimeout(() => logsController.abort(), 15000)
      try {
        const logsResponse = await fetch(`${mcpUrl}/api/logs`, { signal: logsController.signal })
        clearTimeout(logsTimeout)
        if (logsResponse.ok) {
          const logsText = await logsResponse.text()
          console.log(`[Step 1] d3k logs (last 1000 chars):\n${logsText.slice(-1000)}`)
        } else {
          console.log(`[Step 1] Could not fetch d3k logs: ${logsResponse.status}`)
        }
      } catch (error) {
        clearTimeout(logsTimeout)
        const isTimeout = error instanceof Error && error.name === "AbortError"
        console.log(
          `[Step 1] Failed to fetch d3k logs: ${isTimeout ? "Timed out after 15s" : error instanceof Error ? error.message : String(error)}`
        )
      }

      // Call fix_my_app with focusArea='performance' to capture CLS and jank
      console.log("[Step 1] Calling fix_my_app with focusArea='performance'...")

      // Set a 3-minute timeout for the MCP call
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3 * 60 * 1000)

      try {
        const mcpResponse = await fetch(`${mcpUrl}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "fix_my_app",
              arguments: {
                mode: "snapshot",
                focusArea: "performance",
                timeRangeMinutes: 5,
                returnRawData: false
              }
            }
          }),
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!mcpResponse.ok) {
          throw new Error(`MCP request failed: ${mcpResponse.status}`)
        }

        // Parse SSE response
        const text = await mcpResponse.text()
        console.log(`[Step 1] fix_my_app response length: ${text.length} bytes`)
        console.log(`[Step 1] fix_my_app response preview (first 500 chars):\n${text.substring(0, 500)}`)

        const lines = text.split("\n")
        console.log(`[Step 1] Response split into ${lines.length} lines`)

        let logAnalysis = ""
        let linesProcessed = 0
        let contentBlocks = 0

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            linesProcessed++
            try {
              const json = JSON.parse(line.substring(6))
              console.log(`[Step 1] Parsed JSON line ${linesProcessed}:`, JSON.stringify(json).substring(0, 200))

              if (json.result?.content) {
                for (const content of json.result.content) {
                  if (content.type === "text") {
                    contentBlocks++
                    logAnalysis += content.text
                    console.log(`[Step 1] Added text content block ${contentBlocks}, length: ${content.text.length}`)
                  }
                }
              } else if (json.error) {
                console.log(`[Step 1] ERROR in response: ${JSON.stringify(json.error)}`)
              }
            } catch (error) {
              console.log(
                `[Step 1] Failed to parse JSON line ${linesProcessed}: ${error instanceof Error ? error.message : String(error)}`
              )
              console.log(`[Step 1] Problem line: ${line.substring(0, 200)}`)
            }
          }
        }

        console.log(`[Step 1] Processed ${linesProcessed} data lines, ${contentBlocks} content blocks`)
        console.log(`[Step 1] Got ${logAnalysis.length} chars from fix_my_app (performance analysis)`)

        if (logAnalysis.length === 0) {
          console.log(`[Step 1] WARNING: fix_my_app returned NO data. Full response:\n${text}`)
        }

        return {
          logAnalysis: `d3k Performance Analysis for ${devUrl}\n\n${logAnalysis}`,
          beforeScreenshotUrl
        }
      } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof Error && error.name === "AbortError") {
          console.log("[Step 1] fix_my_app timed out after 3 minutes, using fallback method")
          // Fall through to fallback method below
        } else {
          console.log(`[Step 1] fix_my_app error: ${error instanceof Error ? error.message : String(error)}`)
          // Fall through to fallback method below
        }
      }
    }

    // Fallback: Use AI Gateway with browser automation prompting
    console.log("[Step 1] Using AI Gateway with browser automation...")
    const gateway = createGateway({
      apiKey: process.env.AI_GATEWAY_API_KEY,
      baseURL: "https://ai-gateway.vercel.sh/v1/ai"
    })

    const model = gateway("anthropic/claude-sonnet-4-20250514")

    const prompt = `You are a web application debugger with access to browser automation tools via Playwright MCP.

Your task is to visit this URL and capture any errors, warnings, or issues:
${urlWithBypass}

Steps to follow:
1. Use browser_eval with action="start" to start the browser
2. Use browser_eval with action="navigate" and params={url: "${urlWithBypass}"} to navigate to the page
3. Wait a few seconds for the page to fully load and JavaScript to execute
4. Use browser_eval with action="console_messages" to get all browser console output (errors, warnings, logs)
5. Use browser_eval with action="screenshot" to capture a screenshot
6. Use browser_eval with action="close" to close the browser

Analyze the console messages and provide a detailed report including:
- All console errors (with full stack traces if available)
- All console warnings
- HTTP status codes or network errors
- Any visual issues you can identify from the screenshot
- Screenshot URL if captured

Format your response as a clear, structured report that helps identify what's broken in the application.`

    const { text } = await generateText({
      model,
      prompt,
      toolChoice: "auto",
      // @ts-expect-error - AI SDK types for maxTokens are incomplete
      maxTokens: 4000
    })

    console.log(`[Step 1] Browser automation response (first 500 chars): ${text.substring(0, 500)}...`)
    return { logAnalysis: `Browser Automation Analysis for ${devUrl}\n\n${text}`, beforeScreenshotUrl: null }
  } catch (error) {
    console.error("[Step 1] Error with browser automation:", error)

    // Fallback to simple fetch if browser automation fails
    console.log("[Step 1] Falling back to simple HTTP fetch...")
    try {
      const urlWithBypass = bypassToken ? `${devUrl}?x-vercel-protection-bypass=${bypassToken}` : devUrl
      const headers: HeadersInit = {
        "User-Agent": "dev3000-cloud-fix/1.0",
        Accept: "text/html,application/json,*/*"
      }
      if (bypassToken) {
        headers["x-vercel-protection-bypass"] = bypassToken
      }

      const response = await fetch(urlWithBypass, { method: "GET", headers })
      const body = await response.text()

      let logAnalysis = `Dev Server URL: ${devUrl}\n`
      logAnalysis += `HTTP Status: ${response.status} ${response.statusText}\n\n`
      logAnalysis += `Note: Browser automation failed, using fallback HTTP fetch.\n\n`

      if (!response.ok) {
        logAnalysis += `ERROR: HTTP ${response.status} ${response.statusText}\n\n`
      }

      if (body.includes("ReferenceError") || body.includes("Error") || body.includes("error")) {
        logAnalysis += `Response body contains error information:\n${body.substring(0, 5000)}\n\n`
      } else if (!response.ok) {
        logAnalysis += `Response body:\n${body.substring(0, 2000)}\n\n`
      } else {
        logAnalysis += "No errors detected in response.\n"
      }

      return { logAnalysis, beforeScreenshotUrl: null }
    } catch (fallbackError) {
      const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      return {
        logAnalysis: `Failed to fetch logs from ${devUrl}\n\nError: ${errorMessage}\n\nThis may indicate the dev server is not accessible or has crashed.`,
        beforeScreenshotUrl: null
      }
    }
  }
}

/**
 * Step 2: Invoke AI agent to analyze logs and propose fixes
 * Uses AI SDK with AI Gateway for multi-model support
 */
export async function analyzeLogsWithAgent(logAnalysis: string, devUrl: string) {
  "use step"

  console.log("[Step 2] Invoking AI agent to analyze logs...")

  // Create AI Gateway instance
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  // Use Claude Sonnet 4 via AI Gateway
  const model = gateway("anthropic/claude-sonnet-4-20250514")

  const prompt = `You are a skilled software engineer debugging an application.

The dev server is running at: ${devUrl}

Here's the log analysis from the MCP fix_my_app tool:
${logAnalysis}

Your task:
1. Identify the most critical error or issue from the logs
2. Determine the root cause
3. Propose a specific code fix with file paths and changes
4. Create a git-style unified diff that can be applied with 'git apply'
5. Explain why this fix will resolve the issue

Format your response EXACTLY as follows:

## Issue
[Brief description of the issue]

## Root Cause
[Explanation of what's causing the issue]

## Proposed Fix
[High-level explanation of the fix]

## Git Patch
\`\`\`diff
[Full unified diff format that can be applied with 'git apply' or 'patch']
[Include file paths, line numbers, and exact changes]
[Example format:]
[diff --git a/path/to/file.ts b/path/to/file.ts]
[index abc123..def456 100644]
[--- a/path/to/file.ts]
[+++ b/path/to/file.ts]
[@@ -10,7 +10,7 @@ function example() {]
[ unchanged line]
[-  old line to remove]
[+  new line to add]
[ unchanged line]
\`\`\`

## Reasoning
[Why this fix will work]

IMPORTANT:
- The Git Patch section must be a valid unified diff that can be applied directly with 'git apply'.
- If no errors are found, respond with "✅ **SYSTEM HEALTHY** - No errors found" and do NOT include a Git Patch section.
- Only include a Git Patch if there are actual issues that need fixing.`

  const { text } = await generateText({
    model,
    prompt
  })

  console.log(`[Step 2] AI agent response (first 500 chars): ${text.substring(0, 500)}...`)

  return text
}

/**
 * Step 3: Upload fix proposal to blob storage and return URL
 */
export async function uploadToBlob(
  fixProposal: string,
  projectName: string,
  logAnalysis: string,
  devUrl: string,
  beforeScreenshotUrl?: string | null
) {
  "use step"

  console.log("[Step 3] Uploading fix proposal to blob storage...")
  if (beforeScreenshotUrl) {
    console.log(`[Step 3] Including before screenshot: ${beforeScreenshotUrl}`)
  }

  // Create screenshot section if we have a screenshot
  const screenshotSection = beforeScreenshotUrl
    ? `## Before Screenshot

This screenshot was captured when the sandbox dev server first loaded, proving the page rendered successfully.

![Before Screenshot](${beforeScreenshotUrl})

---

`
    : ""

  // Create enhanced markdown with full context and attribution
  const timestamp = new Date().toISOString()
  const enhancedMarkdown = `# Fix Proposal for ${projectName}

**Generated**: ${timestamp}
**Powered by**: [dev3000](https://github.com/vercel-labs/dev3000) with Claude Code
**Dev Server**: ${devUrl}

---

${screenshotSection}## Original Log Analysis

\`\`\`
${logAnalysis}
\`\`\`

---

${fixProposal}

---

## Attribution

This fix proposal was automatically generated by [dev3000](https://github.com/vercel-labs/dev3000),
an AI-powered debugging tool that analyzes your application logs and suggests fixes.

**Co-Authored-By**: Claude (dev3000) <noreply@anthropic.com>

### About dev3000

dev3000 monitors your development server, captures errors in real-time, and uses AI to:
- Analyze error logs and stack traces
- Identify root causes
- Generate actionable fix proposals with git patches
- Suggest specific code changes

Learn more at https://github.com/vercel-labs/dev3000
`

  // Upload to Vercel Blob Storage
  const filenameTimestamp = timestamp.replace(/[:.]/g, "-")
  const filename = `fix-${projectName}-${filenameTimestamp}.md`

  const blob = await put(filename, enhancedMarkdown, {
    access: "public",
    contentType: "text/markdown"
  })

  console.log(`[Step 3] Fix proposal uploaded to: ${blob.url}`)

  return {
    success: true,
    projectName,
    fixProposal,
    blobUrl: blob.url,
    message: "Fix analysis completed and uploaded to blob storage"
  }
}

/**
 * Step 4: Create GitHub PR with the fix
 * Uses GitHub API to create a branch, commit the patch, and open a PR
 */
export async function createGitHubPR(
  fixProposal: string,
  blobUrl: string,
  repoOwner: string,
  repoName: string,
  baseBranch: string,
  projectName: string
) {
  "use step"

  console.log(`[Step 4] Creating GitHub PR for ${repoOwner}/${repoName}...`)

  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) {
    console.error("[Step 4] GITHUB_TOKEN not found in environment")
    return {
      success: false,
      error: "GitHub token not configured"
    }
  }

  try {
    // Extract the git patch from the fix proposal
    const patchMatch = fixProposal.match(/```diff\n([\s\S]*?)\n```/)
    if (!patchMatch) {
      console.error("[Step 4] No git patch found in fix proposal")
      return {
        success: false,
        error: "No git patch found in fix proposal"
      }
    }

    const patch = patchMatch[1]
    console.log(`[Step 4] Extracted patch (${patch.length} chars)`)

    // Parse the patch to extract file changes
    const fileChanges = parsePatchToFileChanges(patch)
    if (fileChanges.length === 0) {
      console.error("[Step 4] Failed to parse any file changes from patch")
      return {
        success: false,
        error: "Failed to parse file changes from patch"
      }
    }

    console.log(`[Step 4] Parsed ${fileChanges.length} file change(s)`)

    // Create a unique branch name
    const branchName = `dev3000-fix-${projectName}-${Date.now()}`
    console.log(`[Step 4] Branch name: ${branchName}`)

    // Get the base branch SHA
    const baseRef = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${baseBranch}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json"
      }
    })

    if (!baseRef.ok) {
      const error = await baseRef.text()
      console.error(`[Step 4] Failed to get base branch: ${error}`)
      return {
        success: false,
        error: `Failed to get base branch: ${baseRef.status}`
      }
    }

    const baseData = await baseRef.json()
    const baseSha = baseData.object.sha
    console.log(`[Step 4] Base SHA: ${baseSha}`)

    // Create new branch
    const createBranch = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      })
    })

    if (!createBranch.ok) {
      const error = await createBranch.text()
      console.error(`[Step 4] Failed to create branch: ${error}`)
      return {
        success: false,
        error: `Failed to create branch: ${createBranch.status}`
      }
    }

    console.log(`[Step 4] Created branch: ${branchName}`)

    // For each file, fetch current content, apply changes, and commit
    for (const fileChange of fileChanges) {
      console.log(`[Step 4] Processing file: ${fileChange.path}`)

      // Get current file content
      const fileResp = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${fileChange.path}?ref=${branchName}`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json"
          }
        }
      )

      let currentContent = ""
      let currentSha = ""

      if (fileResp.ok) {
        const fileData = await fileResp.json()
        currentSha = fileData.sha
        currentContent = Buffer.from(fileData.content, "base64").toString("utf-8")
      } else {
        console.log(`[Step 4] File doesn't exist, will create new file`)
      }

      // Apply the patch changes to the content
      const newContent = applyPatchChanges(currentContent, fileChange.changes)

      // Update file
      const updateFile = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${fileChange.path}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: `Fix: Apply dev3000 fix for ${projectName}`,
            content: Buffer.from(newContent).toString("base64"),
            branch: branchName,
            ...(currentSha && { sha: currentSha })
          })
        }
      )

      if (!updateFile.ok) {
        const error = await updateFile.text()
        console.error(`[Step 4] Failed to update file ${fileChange.path}: ${error}`)
        return {
          success: false,
          error: `Failed to update file ${fileChange.path}: ${updateFile.status}`
        }
      }

      console.log(`[Step 4] Updated file: ${fileChange.path}`)
    }

    // Create PR
    const prBody = `## Automated Fix Proposal

This PR was automatically generated by [dev3000](https://github.com/vercel-labs/dev3000) after analyzing your application.

### Fix Details
View the full analysis: [${blobUrl}](${blobUrl})

${fixProposal}

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude (dev3000) <noreply@anthropic.com>`

    const createPR = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: `Fix: ${projectName} - Automated fix from dev3000`,
        head: branchName,
        base: baseBranch,
        body: prBody
      })
    })

    if (!createPR.ok) {
      const error = await createPR.text()
      console.error(`[Step 4] Failed to create PR: ${error}`)
      return {
        success: false,
        error: `Failed to create PR: ${createPR.status}`
      }
    }

    const prData = await createPR.json()
    console.log(`[Step 4] Created PR: ${prData.html_url}`)

    return {
      success: true,
      prUrl: prData.html_url,
      prNumber: prData.number,
      branch: branchName
    }
  } catch (error) {
    console.error("[Step 4] Error creating PR:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Parse a git patch into file changes
 */
function parsePatchToFileChanges(patch: string) {
  const fileChanges: Array<{ path: string; changes: string }> = []
  const files = patch.split(/diff --git /).filter(Boolean)

  for (const file of files) {
    const lines = file.split("\n")
    const pathMatch = lines[0].match(/a\/(.*?) b\//)
    if (!pathMatch) continue

    const path = pathMatch[1]
    const changes = lines.slice(1).join("\n")
    fileChanges.push({ path, changes })
  }

  return fileChanges
}

/**
 * Apply patch changes to file content
 * This is a simplified implementation - may need enhancement for complex patches
 */
function applyPatchChanges(content: string, changes: string): string {
  const lines = content.split("\n")
  const changeLines = changes.split("\n")

  let currentLine = 0
  const result: string[] = []

  for (const change of changeLines) {
    if (change.startsWith("@@")) {
      // Parse hunk header to get line number
      const match = change.match(/@@ -(\d+)/)
      if (match) {
        currentLine = Number.parseInt(match[1], 10) - 1
      }
    } else if (change.startsWith("-")) {
      // Remove line
      currentLine++
    } else if (change.startsWith("+")) {
      // Add line
      result.push(change.substring(1))
    } else if (change.startsWith(" ")) {
      // Context line
      if (currentLine < lines.length) {
        result.push(lines[currentLine])
        currentLine++
      }
    }
  }

  return result.join("\n")
}

/**
 * Cleanup step: Stop the sandbox
 */
export async function cleanupSandbox(cleanup: () => Promise<void>) {
  "use step"

  console.log("[Cleanup] Stopping sandbox...")
  try {
    await cleanup()
    console.log("[Cleanup] Sandbox stopped successfully")
  } catch (error) {
    console.error("[Cleanup] Error stopping sandbox:", error)
    // Don't throw - cleanup errors shouldn't fail the workflow
  }
}

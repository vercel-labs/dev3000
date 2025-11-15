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

  return {
    mcpUrl: sandboxResult.mcpUrl,
    devUrl: sandboxResult.devUrl,
    cleanup: sandboxResult.cleanup
  }
}

/**
 * Step 1: Use browser automation to capture real errors
 * Uses d3k MCP server in sandbox (if available) or AI Gateway for browser automation
 */
export async function fetchRealLogs(mcpUrlOrDevUrl: string, bypassToken?: string, sandboxDevUrl?: string) {
  "use step"

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
      console.log("[Step 1] Validating d3k MCP server access...")
      try {
        const toolsResponse = await fetch(`${mcpUrl}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "tools/list"
          })
        })

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
        console.log(
          `[Step 1] ⚠️  Failed to validate MCP server: ${error instanceof Error ? error.message : String(error)}`
        )
      }

      // Navigate to the app to generate logs
      console.log("[Step 1] Navigating browser to app URL...")
      const navResponse = await fetch(`${mcpUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        })
      })

      if (navResponse.ok) {
        console.log("[Step 1] Browser navigation completed")
      } else {
        console.log(`[Step 1] Browser navigation failed: ${navResponse.status}`)
      }

      // Wait for page to fully load
      console.log("[Step 1] Waiting 5s for page load...")
      await new Promise((resolve) => setTimeout(resolve, 5000))

      // Call fix_my_app with focusArea='performance' to capture CLS and jank
      console.log("[Step 1] Calling fix_my_app with focusArea='performance'...")
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
        })
      })

      if (!mcpResponse.ok) {
        throw new Error(`MCP request failed: ${mcpResponse.status}`)
      }

      // Parse SSE response
      const text = await mcpResponse.text()
      const lines = text.split("\n")
      let logAnalysis = ""

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.substring(6))
            if (json.result?.content) {
              for (const content of json.result.content) {
                if (content.type === "text") {
                  logAnalysis += content.text
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      console.log(`[Step 1] Got ${logAnalysis.length} chars from fix_my_app (performance analysis)`)
      return `d3k Performance Analysis for ${devUrl}\n\n${logAnalysis}`
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
    return `Browser Automation Analysis for ${devUrl}\n\n${text}`
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

      return logAnalysis
    } catch (fallbackError) {
      const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      return `Failed to fetch logs from ${devUrl}\n\nError: ${errorMessage}\n\nThis may indicate the dev server is not accessible or has crashed.`
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

## How to Apply
\`\`\`bash
# Save this file and apply the patch:
curl [BLOB_URL] | git apply
\`\`\`

IMPORTANT: The Git Patch section must be a valid unified diff that can be applied directly with 'git apply'.
If no errors are found, respond with "No critical issues detected."`

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
export async function uploadToBlob(fixProposal: string, projectName: string, logAnalysis: string, devUrl: string) {
  "use step"

  console.log("[Step 3] Uploading fix proposal to blob storage...")

  // Create enhanced markdown with full context and attribution
  const timestamp = new Date().toISOString()
  const enhancedMarkdown = `# Fix Proposal for ${projectName}

**Generated**: ${timestamp}
**Powered by**: [dev3000](https://github.com/vercel-labs/dev3000) with Claude Code
**Dev Server**: ${devUrl}

---

## Original Log Analysis

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

/**
 * Step functions for fix-workflow
 * Separated into their own module to avoid workflow bundler issues
 */

import { put } from "@vercel/blob"
import type { Sandbox } from "@vercel/sandbox"
import { createGateway, generateText, stepCountIs, tool } from "ai"
import { z } from "zod"
import { createD3kSandbox as createD3kSandboxUtil } from "@/lib/cloud/d3k-sandbox"
import type { WorkflowReport } from "@/types"

/**
 * D3K Sandbox Tools
 * These tools allow the AI agent to interact with the sandbox environment
 * where d3k is running, giving it access to code, search, and MCP capabilities
 */

/**
 * Create tools that execute against the sandbox
 * These are d3k-specific - they know about the sandbox structure and d3k MCP
 */
function createD3kSandboxTools(sandbox: Sandbox, mcpUrl: string) {
  const SANDBOX_CWD = "/vercel/sandbox"

  return {
    /**
     * Read a file from the sandbox
     */
    readFile: tool({
      description:
        "Read a file from the codebase. Use this to understand code before proposing fixes. Path should be relative to project root (e.g., 'src/components/Header.tsx').",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        maxLines: z.number().optional().describe("Maximum lines to read (default: 500)")
      }),
      execute: async ({ path, maxLines = 500 }: { path: string; maxLines?: number }) => {
        const fullPath = `${SANDBOX_CWD}/${path}`
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `head -n ${maxLines} "${fullPath}" 2>&1 || echo "ERROR: File not found or unreadable"`
        ])
        if (result.stdout.startsWith("ERROR:")) {
          return `Failed to read ${path}: ${result.stdout}`
        }
        return `Contents of ${path}:\n\`\`\`\n${result.stdout}\n\`\`\``
      }
    }),

    /**
     * Search for files by glob pattern
     */
    globSearch: tool({
      description:
        "Find files matching a glob pattern. Use this to discover relevant files. Examples: '**/*.tsx', 'src/components/*.ts', '**/Header*'",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern to match files"),
        maxResults: z.number().optional().describe("Maximum results (default: 20)")
      }),
      execute: async ({ pattern, maxResults = 20 }: { pattern: string; maxResults?: number }) => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && find . -type f -name "${pattern}" 2>/dev/null | head -n ${maxResults} | sed 's|^\\./||'`
        ])
        if (!result.stdout.trim()) {
          return `No files found matching pattern: ${pattern}`
        }
        const files = result.stdout.trim().split("\n")
        return `Found ${files.length} file(s) matching "${pattern}":\n${files.map((f) => `- ${f}`).join("\n")}`
      }
    }),

    /**
     * Search file contents with grep
     */
    grepSearch: tool({
      description:
        "Search for text/patterns in files. Use this to find where specific code, classes, or functions are defined or used.",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern (regex supported)"),
        fileGlob: z.string().optional().describe("File pattern to search in (e.g., '*.tsx')"),
        maxResults: z.number().optional().describe("Maximum results (default: 20)")
      }),
      execute: async ({
        pattern,
        fileGlob,
        maxResults = 20
      }: {
        pattern: string
        fileGlob?: string
        maxResults?: number
      }) => {
        const includeArg = fileGlob ? `--include="${fileGlob}"` : ""
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && grep -rn ${includeArg} "${pattern}" . 2>/dev/null | head -n ${maxResults}`
        ])
        if (!result.stdout.trim()) {
          return `No matches found for pattern: ${pattern}`
        }
        return `Search results for "${pattern}":\n${result.stdout}`
      }
    }),

    /**
     * List directory contents
     */
    listDirectory: tool({
      description: "List files and directories at a path. Use this to explore the project structure.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory path relative to project root (default: root)")
      }),
      execute: async ({ path = "" }: { path?: string }) => {
        const fullPath = path ? `${SANDBOX_CWD}/${path}` : SANDBOX_CWD
        const result = await runSandboxCommand(sandbox, "sh", ["-c", `ls -la "${fullPath}" 2>&1`])
        return `Contents of ${path || "/"}:\n${result.stdout}`
      }
    }),

    /**
     * Call d3k MCP tool - find_component_source
     * This is d3k-specific: maps DOM elements to React component source
     */
    findComponentSource: tool({
      description:
        "Find the source file for a React component by its DOM selector. Use this when you know which element caused a layout shift and need to find the source file to fix it. d3k-specific tool.",
      inputSchema: z.object({
        selector: z.string().describe("CSS selector for the DOM element (e.g., 'nav', '.header', '#main')")
      }),
      execute: async ({ selector }: { selector: string }) => {
        try {
          const mcpResponse = await fetch(`${mcpUrl}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "find_component_source",
                arguments: { selector }
              }
            })
          })

          if (!mcpResponse.ok) {
            return `Failed to call find_component_source: HTTP ${mcpResponse.status}`
          }

          const text = await mcpResponse.text()
          // Parse SSE response
          const lines = text.split("\n")
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const json = JSON.parse(line.substring(6))
                if (json.result?.content) {
                  for (const content of json.result.content) {
                    if (content.type === "text") {
                      return content.text
                    }
                  }
                }
              } catch {
                // Continue to next line on parse failure
              }
            }
          }
          return `No result from find_component_source for selector: ${selector}`
        } catch (error) {
          return `Error calling find_component_source: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }),

    /**
     * Write/edit a file in the sandbox
     */
    writeFile: tool({
      description:
        "Write content to a file. Use this to apply fixes. For small edits, prefer editFile. For creating new files or complete rewrites, use this.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        content: z.string().describe("Complete file content to write")
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const fullPath = `${SANDBOX_CWD}/${path}`
        // Escape content for shell
        const escapedContent = content.replace(/'/g, "'\\''")
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cat > "${fullPath}" << 'FILEEOF'\n${escapedContent}\nFILEEOF`
        ])
        if (result.exitCode !== 0) {
          return `Failed to write ${path}: ${result.stderr}`
        }
        return `Successfully wrote ${content.length} characters to ${path}`
      }
    }),

    /**
     * Get git diff of changes made so far
     */
    getGitDiff: tool({
      description:
        "Get the git diff of all changes made in the sandbox. Use this to review your fixes before finalizing.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && git diff --no-color 2>/dev/null || echo "No changes or not a git repo"`
        ])
        if (!result.stdout.trim() || result.stdout.includes("No changes")) {
          return "No changes have been made yet."
        }
        return `Current changes:\n\`\`\`diff\n${result.stdout}\n\`\`\``
      }
    })
  }
}

/**
 * Save or update a workflow report to blob storage
 * This is called incrementally as data becomes available throughout the workflow
 */
export async function saveReportToBlob(
  report: Partial<WorkflowReport> & { id: string; projectName: string; timestamp: string }
): Promise<string> {
  // Use consistent filename based on report ID so updates overwrite the same file
  const filename = `report-${report.id}.json`

  const blob = await put(filename, JSON.stringify(report, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false, // Important: ensures we can update the same file
    allowOverwrite: true // Required: allows updating the same file on subsequent saves
  })

  console.log(`[Report] Saved report ${report.id} to: ${blob.url}`)
  return blob.url
}

/**
 * Helper function to properly consume sandbox command output
 * The Vercel Sandbox SDK returns a result object with an async logs() iterator
 */
async function runSandboxCommand(
  sandbox: Sandbox,
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

/**
 * Capture a screenshot using puppeteer-core inside the sandbox
 * Returns the base64 encoded PNG image data and logs the page title
 */
async function captureScreenshotInSandbox(
  sandbox: Sandbox,
  appUrl: string,
  chromiumPath: string,
  label: string,
  sandboxCwd = "/vercel/sandbox"
): Promise<string | null> {
  console.log(`[Screenshot] Capturing ${label} screenshot of ${appUrl}...`)

  // Create a Node.js script to capture screenshot with puppeteer-core
  // The script is placed in the sandbox cwd so it can find puppeteer-core from node_modules
  // Output format: JSON with { title, screenshot } on first line, then base64 data
  const screenshotScript = `
const puppeteer = require('puppeteer-core');

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '${chromiumPath}',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Navigate with a reasonable timeout
    await page.goto('${appUrl}', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Get the page title for verification
    const title = await page.title();
    console.error('PAGE_TITLE:' + title);

    // Wait a bit for any animations/layout shifts
    await new Promise(r => setTimeout(r, 2000));

    // Take screenshot as base64
    const screenshot = await page.screenshot({
      encoding: 'base64',
      fullPage: false
    });

    console.log(screenshot);

    await browser.close();
  } catch (error) {
    console.error('Screenshot error:', error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
`

  try {
    // Write the script to the sandbox cwd so it can find puppeteer-core from node_modules
    const scriptPath = `${sandboxCwd}/_screenshot.js`
    const writeResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cat > ${scriptPath} << 'SCRIPT_EOF'
${screenshotScript}
SCRIPT_EOF`
    ])

    if (writeResult.exitCode !== 0) {
      console.log(`[Screenshot] Failed to write script: ${writeResult.stderr}`)
      return null
    }

    // Run the script from the sandbox directory so node can find puppeteer-core in node_modules
    const screenshotResult = await sandbox.runCommand({
      cmd: "node",
      args: [scriptPath],
      cwd: sandboxCwd
    })

    let stdout = ""
    let stderr = ""
    for await (const log of screenshotResult.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
      } else {
        stderr += log.data
      }
    }
    await screenshotResult.wait()

    // Extract page title from stderr (format: PAGE_TITLE:xxx)
    const titleMatch = stderr.match(/PAGE_TITLE:(.*)/)
    if (titleMatch) {
      console.log(`[Screenshot] Page title: "${titleMatch[1]}"`)
    }

    if (screenshotResult.exitCode !== 0) {
      console.log(`[Screenshot] Failed to capture: ${stderr}`)
      return null
    }

    // The stdout should be the base64 image
    const base64Data = stdout.trim()
    if (base64Data && base64Data.length > 100) {
      console.log(`[Screenshot] Captured ${label} screenshot (${base64Data.length} bytes base64)`)
      return base64Data
    }

    console.log(`[Screenshot] No valid screenshot data returned`)
    return null
  } catch (error) {
    console.log(`[Screenshot] Error: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Upload a base64 screenshot to Vercel Blob
 */
async function uploadScreenshot(base64Data: string, label: string, projectName: string): Promise<string | null> {
  try {
    const imageBuffer = Buffer.from(base64Data, "base64")
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `screenshot-${label}-${projectName}-${timestamp}.png`

    const blob = await put(filename, imageBuffer, {
      access: "public",
      contentType: "image/png"
    })

    console.log(`[Screenshot] Uploaded ${label} screenshot: ${blob.url}`)
    return blob.url
  } catch (error) {
    console.log(`[Screenshot] Upload failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Fetch d3k's CLS jank screenshots from the sandbox MCP server and upload to Vercel Blob
 * Returns URLs to the uploaded screenshots and metadata
 */
async function fetchAndUploadD3kArtifacts(
  sandbox: Sandbox,
  _mcpUrl: string,
  projectName: string
): Promise<{
  clsScreenshots: Array<{ label: string; blobUrl: string; timestamp: number }>
  screencastSessionId: string | null
  fullLogs: string | null
  metadata: Record<string, unknown> | null
}> {
  const result: {
    clsScreenshots: Array<{ label: string; blobUrl: string; timestamp: number }>
    screencastSessionId: string | null
    fullLogs: string | null
    metadata: Record<string, unknown> | null
  } = {
    clsScreenshots: [],
    screencastSessionId: null,
    fullLogs: null,
    metadata: null
  }

  console.log(`[D3k Artifacts] Fetching screenshots and logs from sandbox MCP server...`)

  try {
    // 1. Fetch full d3k logs from the sandbox
    console.log(`[D3k Artifacts] Fetching d3k logs...`)
    const logsResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && cat "$log" || true; done 2>/dev/null || echo "No log files found"'
    ])
    if (logsResult.exitCode === 0 && logsResult.stdout) {
      result.fullLogs = logsResult.stdout
      console.log(`[D3k Artifacts] Captured ${result.fullLogs.length} chars of d3k logs`)
    }

    // 2. Parse logs to find screenshot URLs and session ID
    if (result.fullLogs) {
      // Extract screenshot filenames from logs like:
      // [CDP]   Before: http://localhost:3684/api/screenshots/2025-12-06T21-39-24Z-jank-388ms.png
      const screenshotRegex = /http:\/\/localhost:\d+\/api\/screenshots\/([^\s]+\.png)/g
      const screenshotMatches = [...result.fullLogs.matchAll(screenshotRegex)]
      const uniqueFilenames = [...new Set(screenshotMatches.map((m) => m[1]))]
      console.log(`[D3k Artifacts] Found ${uniqueFilenames.length} screenshot filenames in logs`)

      // Extract session ID from screencast URL like:
      // [SCREENCAST] View frame analysis: http://localhost:3684/video/2025-12-06T21-39-24Z
      const sessionMatch = result.fullLogs.match(/\/video\/([^\s]+)/)
      if (sessionMatch) {
        result.screencastSessionId = sessionMatch[1]
        console.log(`[D3k Artifacts] Screencast session ID: ${result.screencastSessionId}`)
      }

      // 3. Fetch and upload each screenshot to Vercel Blob
      for (const filename of uniqueFilenames) {
        try {
          // Fetch screenshot from sandbox MCP server
          console.log(`[D3k Artifacts] Fetching screenshot: ${filename}`)

          // Use curl from inside sandbox to get the screenshot as base64
          const fetchResult = await runSandboxCommand(sandbox, "sh", [
            "-c",
            `curl -s http://localhost:3684/api/screenshots/${filename} | base64`
          ])

          if (fetchResult.exitCode === 0 && fetchResult.stdout.trim().length > 100) {
            const base64Data = fetchResult.stdout.trim()

            // Upload to Vercel Blob
            const imageBuffer = Buffer.from(base64Data, "base64")
            const blobFilename = `d3k-cls-${projectName}-${filename}`
            const blob = await put(blobFilename, imageBuffer, {
              access: "public",
              contentType: "image/png"
            })

            // Extract timestamp from filename like "2025-12-06T21-39-24Z-jank-388ms.png"
            const timestampMatch = filename.match(/-(\d+)ms\.png$/)
            const timestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : 0

            result.clsScreenshots.push({
              label: filename,
              blobUrl: blob.url,
              timestamp
            })

            console.log(`[D3k Artifacts] Uploaded ${filename} -> ${blob.url}`)
          } else {
            console.log(`[D3k Artifacts] Failed to fetch ${filename}: empty or error`)
          }
        } catch (error) {
          console.log(
            `[D3k Artifacts] Error fetching screenshot ${filename}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      // 4. Fetch metadata JSON if available
      if (result.screencastSessionId) {
        try {
          const metadataResult = await runSandboxCommand(sandbox, "sh", [
            "-c",
            `curl -s http://localhost:3684/api/screenshots/${result.screencastSessionId}-metadata.json`
          ])
          if (metadataResult.exitCode === 0 && metadataResult.stdout.trim().startsWith("{")) {
            result.metadata = JSON.parse(metadataResult.stdout.trim())
            console.log(
              `[D3k Artifacts] Captured metadata: CLS score ${(result.metadata as { totalCLS?: number })?.totalCLS}`
            )
          }
        } catch {
          console.log(`[D3k Artifacts] Could not fetch metadata`)
        }
      }

      // 5. FALLBACK: Parse CLS score directly from logs if metadata is unavailable or missing totalCLS
      // This is a fallback because the metadata endpoint may not always be available
      if (!result.metadata || (result.metadata as { totalCLS?: number })?.totalCLS === undefined) {
        console.log(`[D3k Artifacts] Attempting to parse CLS from logs as fallback...`)
        // Parse layout shift scores from logs like:
        // [BROWSER] [CDP] Layout shift detected (element: DIV, position: static, score: 0.4716, time: 1025ms)
        const clsRegex = /Layout shift detected.*score:\s*([\d.]+)/g
        const clsMatches = [...result.fullLogs.matchAll(clsRegex)]
        if (clsMatches.length > 0) {
          const scores = clsMatches.map((m) => parseFloat(m[1]))
          const totalCLS = scores.reduce((sum, s) => sum + s, 0)
          const clsGrade: "good" | "needs-improvement" | "poor" =
            totalCLS <= 0.1 ? "good" : totalCLS <= 0.25 ? "needs-improvement" : "poor"

          console.log(`[D3k Artifacts] Parsed ${scores.length} layout shifts from logs, total CLS: ${totalCLS}`)
          result.metadata = {
            ...result.metadata,
            totalCLS,
            clsGrade,
            layoutShifts: scores.map((score, i) => ({
              score,
              timestamp: i * 100, // Approximate timestamps
              sources: []
            })),
            parsedFromLogs: true // Flag to indicate this was parsed from logs
          }
        } else {
          console.log(`[D3k Artifacts] No layout shift data found in logs`)
        }
      }
    }

    console.log(
      `[D3k Artifacts] Summary: ${result.clsScreenshots.length} screenshots, ${result.fullLogs ? "logs captured" : "no logs"}, metadata: ${result.metadata ? "yes" : "no"}`
    )
  } catch (error) {
    console.log(`[D3k Artifacts] Error: ${error instanceof Error ? error.message : String(error)}`)
  }

  return result
}

/**
 * Step 0: Create d3k sandbox with MCP tools pre-configured
 * Also captures a "before" screenshot of the app and saves initial report to blob
 */
export async function createD3kSandbox(
  repoUrl: string,
  branch: string,
  projectName: string,
  vercelToken?: string,
  vercelOidcToken?: string,
  runId?: string
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

  // Get the chromium path for screenshots
  console.log(`[Step 0] Getting Chromium path for screenshots...`)
  let chromiumPath = "/tmp/chromium"
  try {
    const chromiumResult = await runSandboxCommand(sandboxResult.sandbox, "node", [
      "-e",
      "require('@sparticuz/chromium').executablePath().then(p => console.log(p))"
    ])
    if (chromiumResult.exitCode === 0 && chromiumResult.stdout.trim()) {
      chromiumPath = chromiumResult.stdout.trim()
      console.log(`[Step 0] Chromium path: ${chromiumPath}`)
    }
  } catch {
    console.log(`[Step 0] Could not get chromium path, using default: ${chromiumPath}`)
  }

  // CRITICAL DIAGNOSTIC: Test Chrome with EXACT d3k command
  // d3k uses: --user-data-dir, no --remote-debugging-address, loading page, etc.
  console.log(`[Step 0] ===== CHROMIUM CDP TEST (d3k exact command) =====`)
  try {
    const chromeTestScript = `
      exec 2>&1
      echo "=== Chromium CDP Test (d3k exact command) ==="
      echo "Chromium path: ${chromiumPath}"
      echo ""

      # Create user-data-dir like d3k does
      USER_DATA_DIR="/tmp/d3k-test-profile"
      mkdir -p "$USER_DATA_DIR"
      echo "1. Created user-data-dir: $USER_DATA_DIR"

      # Create loading page like d3k does
      LOADING_DIR="/tmp/dev3000-loading"
      mkdir -p "$LOADING_DIR"
      cat > "$LOADING_DIR/loading.html" << 'LOADINGHTML'
<!DOCTYPE html>
<html>
<head><title>Loading...</title></head>
<body><h1>Loading dev3000...</h1></body>
</html>
LOADINGHTML
      echo "2. Created loading page: $LOADING_DIR/loading.html"
      echo ""

      # Use EXACT d3k command (from cdp-monitor.ts)
      # Note: d3k does NOT use --remote-debugging-address
      echo "3. Starting Chrome with d3k's exact args..."
      echo "   Command: ${chromiumPath} --remote-debugging-port=9222 --user-data-dir=$USER_DATA_DIR --no-first-run --no-default-browser-check --disable-component-extensions-with-background-pages --disable-background-networking --disable-sync --metrics-recording-only --disable-default-apps --disable-session-crashed-bubble --disable-restore-session-state --headless=new --no-sandbox --disable-setuid-sandbox --disable-gpu --disable-dev-shm-usage file://$LOADING_DIR/loading.html"

      timeout 15 "${chromiumPath}" \\
        --remote-debugging-port=9222 \\
        --user-data-dir="$USER_DATA_DIR" \\
        --no-first-run \\
        --no-default-browser-check \\
        --disable-component-extensions-with-background-pages \\
        --disable-background-networking \\
        --disable-sync \\
        --metrics-recording-only \\
        --disable-default-apps \\
        --disable-session-crashed-bubble \\
        --disable-restore-session-state \\
        --headless=new \\
        --no-sandbox \\
        --disable-setuid-sandbox \\
        --disable-gpu \\
        --disable-dev-shm-usage \\
        "file://$LOADING_DIR/loading.html" &
      PID=$!
      echo "   Chrome PID: $PID"
      sleep 3
      echo ""

      echo "4. Checking if Chrome is still running..."
      if ps -p $PID > /dev/null 2>&1; then
        echo "   Chrome is RUNNING after 3s"
        echo ""
        echo "5. Trying CDP (note: d3k doesn't use --remote-debugging-address)..."
        echo "   Trying 127.0.0.1..."
        curl -s --max-time 5 http://127.0.0.1:9222/json/version 2>&1 || echo "   127.0.0.1 failed"
        echo ""
        echo "   Trying localhost..."
        curl -s --max-time 5 http://localhost:9222/json/version 2>&1 || echo "   localhost failed"
        echo ""
        echo "6. Checking what's listening on 9222..."
        ss -tlnp 2>/dev/null | grep 9222 || netstat -tlnp 2>/dev/null | grep 9222 || echo "   Could not check listening ports"
        echo ""
        echo "7. Killing test Chrome..."
        kill $PID 2>/dev/null
      else
        echo "   Chrome DIED within 3s"
        wait $PID 2>/dev/null
        EXIT_CODE=$?
        echo "   Exit code: $EXIT_CODE"
        echo ""
        echo "   Checking for crash logs..."
        ls -la "$USER_DATA_DIR" 2>&1 | head -10 || echo "   No user-data-dir"
      fi
      echo ""
      echo "=== End d3k exact command test ==="
    `
    const chromeTest = await runSandboxCommand(sandboxResult.sandbox, "bash", ["-c", chromeTestScript])
    console.log(`[Step 0] d3k Chrome test (exit ${chromeTest.exitCode}):\n${chromeTest.stdout || "(no output)"}`)
    if (chromeTest.stderr) console.log(`[Step 0] d3k Chrome test stderr: ${chromeTest.stderr}`)
  } catch (error) {
    console.log(`[Step 0] d3k Chrome test error: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`[Step 0] ===== END d3k EXACT COMMAND TEST =====`)

  // Capture "BEFORE" screenshot - this shows the app before any fixes
  console.log(`[Step 0] Capturing BEFORE screenshot...`)
  let beforeScreenshotUrl: string | null = null
  try {
    const beforeBase64 = await captureScreenshotInSandbox(
      sandboxResult.sandbox,
      "http://localhost:3000",
      chromiumPath,
      "before"
    )
    if (beforeBase64) {
      beforeScreenshotUrl = await uploadScreenshot(beforeBase64, "before", projectName)
    }
  } catch (error) {
    console.log(`[Step 0] Before screenshot failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Now capture CLS and errors using MCP from INSIDE the sandbox
  console.log(`[Step 0] Capturing CLS metrics from inside sandbox...`)

  let clsData: unknown = null
  let mcpError: string | null = null

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
                console.log(`[Step 0] Successfully parsed CLS data as JSON`)
              } catch {
                // If not JSON, treat as plain text
                clsData = { rawOutput: item.text }
                console.log(`[Step 0] CLS data stored as rawOutput (not JSON)`)
              }
              break
            }
          }
        }

        if (clsData) {
          console.log(`[Step 0] CLS data captured:`, JSON.stringify(clsData).substring(0, 500))
        } else {
          console.log(`[Step 0] No CLS data extracted from MCP response`)
          console.log(`[Step 0] Response structure: ${JSON.stringify(mcpResponse).substring(0, 500)}`)
        }
      } catch (parseError) {
        mcpError = `Failed to parse MCP response: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        console.log(`[Step 0] ${mcpError}`)
        console.log(`[Step 0] Raw stdout: ${stdout.substring(0, 1000)}`)
        // Use raw stdout as fallback CLS data so Step 1 doesn't hang
        clsData = { rawMcpOutput: stdout.substring(0, 10000), parseError: mcpError }
        console.log(`[Step 0] Using raw stdout as fallback CLS data`)
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

  // IMPORTANT: Ensure clsData is ALWAYS set to something truthy so Step 1 doesn't hang on timeouts
  // Even if MCP failed, we should have sandbox logs that Step 1 can use
  if (!clsData) {
    console.log(`[Step 0] WARNING: No CLS data captured, creating placeholder to prevent Step 1 timeout`)
    clsData = {
      warning: "MCP fix_my_app did not return data",
      mcpError: mcpError || "Unknown error",
      sandboxDevUrl: sandboxResult.devUrl,
      sandboxMcpUrl: sandboxResult.mcpUrl
    }
  }
  console.log(`[Step 0] Final clsData truthy check: ${!!clsData}`)

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

  // Capture git diff from sandbox - this shows any changes made by d3k
  console.log(`[Step 0] Capturing git diff from sandbox...`)
  let gitDiff: string | null = null
  try {
    const diffResult = await runSandboxCommand(sandboxResult.sandbox, "sh", [
      "-c",
      "cd /vercel/sandbox && git diff --no-color 2>/dev/null || echo 'No git diff available'"
    ])
    if (diffResult.exitCode === 0 && diffResult.stdout.trim() && diffResult.stdout.trim() !== "No git diff available") {
      gitDiff = diffResult.stdout.trim()
      console.log(`[Step 0] Git diff captured (${gitDiff.length} chars)`)
      console.log(`[Step 0] Git diff preview:\n${gitDiff.substring(0, 500)}...`)
    } else {
      console.log(`[Step 0] No git changes detected in sandbox`)
    }
  } catch (diffError) {
    console.log(
      `[Step 0] Failed to capture git diff: ${diffError instanceof Error ? diffError.message : String(diffError)}`
    )
  }

  // Fetch d3k artifacts (CLS screenshots, full logs, metadata) BEFORE sandbox terminates
  console.log(`[Step 0] Fetching d3k artifacts from sandbox...`)
  const d3kArtifacts = await fetchAndUploadD3kArtifacts(sandboxResult.sandbox, sandboxResult.mcpUrl, projectName)

  // Save initial report to blob storage immediately
  // This ensures we capture CLS data, screenshots, and logs even if later steps fail
  const reportId = runId || `report-${Date.now()}`
  const timestamp = new Date().toISOString()

  // Extract CLS data from d3kArtifacts metadata for the initial report
  let clsScore: number | undefined
  let clsGrade: "good" | "needs-improvement" | "poor" | undefined
  let layoutShifts:
    | Array<{
        score: number
        timestamp: number
        elements: string[]
      }>
    | undefined

  if (d3kArtifacts?.metadata) {
    const meta = d3kArtifacts.metadata as {
      totalCLS?: number
      clsGrade?: string
      layoutShifts?: Array<{
        score: number
        timestamp: number
        sources?: Array<{ node?: string }>
      }>
    }
    clsScore = meta.totalCLS
    if (meta.clsGrade === "good" || meta.clsGrade === "needs-improvement" || meta.clsGrade === "poor") {
      clsGrade = meta.clsGrade
    }
    if (meta.layoutShifts) {
      layoutShifts = meta.layoutShifts.map((shift) => ({
        score: shift.score,
        timestamp: shift.timestamp,
        elements: shift.sources?.map((s) => s.node || "unknown").filter(Boolean) || []
      }))
    }
  }

  // Build and save initial report with all data captured so far
  const initialReport: Partial<WorkflowReport> & { id: string; projectName: string; timestamp: string } = {
    id: reportId,
    projectName,
    timestamp,
    sandboxDevUrl: sandboxResult.devUrl,
    sandboxMcpUrl: sandboxResult.mcpUrl,
    clsScore,
    clsGrade,
    layoutShifts,
    beforeScreenshotUrl: beforeScreenshotUrl || undefined,
    clsScreenshots: d3kArtifacts?.clsScreenshots?.map((s) => ({
      timestamp: s.timestamp,
      blobUrl: s.blobUrl,
      label: s.label
    })),
    d3kLogs: d3kArtifacts?.fullLogs || undefined,
    // Placeholder for agent analysis - will be filled below
    agentAnalysis: "Analysis in progress..."
  }

  console.log(`[Step 0] Saving initial report to blob storage...`)
  console.log(`[Step 0] Report ID: ${reportId}`)
  console.log(`[Step 0] CLS Score: ${clsScore ?? "not captured"}`)
  console.log(`[Step 0] CLS Screenshots: ${initialReport.clsScreenshots?.length ?? 0}`)
  if (initialReport.d3kLogs) {
    console.log(`[Step 0] d3k logs: ${initialReport.d3kLogs.length} chars`)
  }

  const reportBlobUrl = await saveReportToBlob(initialReport)
  console.log(`[Step 0] Initial report saved: ${reportBlobUrl}`)

  // Run AI agent analysis while we still have sandbox access
  // This allows the agent to read/write files and use d3k MCP tools
  console.log(`[Step 0] Running AI agent with sandbox tools...`)
  let agentAnalysis: string | null = null
  try {
    const logAnalysis = clsData ? JSON.stringify(clsData, null, 2) : "No CLS data captured"
    agentAnalysis = await runAgentWithSandboxTools(
      sandboxResult.sandbox,
      sandboxResult.mcpUrl,
      sandboxResult.devUrl,
      logAnalysis
    )
    console.log(`[Step 0] Agent analysis completed (${agentAnalysis.length} chars)`)

    // Update report with agent analysis
    initialReport.agentAnalysis = agentAnalysis
    initialReport.agentAnalysisModel = "anthropic/claude-sonnet-4-20250514"
    await saveReportToBlob(initialReport)
    console.log(`[Step 0] Report updated with agent analysis`)

    // Capture git diff after agent made changes
    console.log(`[Step 0] Checking for git diff after agent execution...`)
    const diffResult = await runSandboxCommand(sandboxResult.sandbox, "sh", [
      "-c",
      "cd /vercel/sandbox && git diff --no-color 2>/dev/null || echo 'No git diff available'"
    ])
    console.log(`[Step 0] Git diff exit code: ${diffResult.exitCode}`)
    console.log(`[Step 0] Git diff stdout length: ${diffResult.stdout?.length ?? 0}`)
    console.log(`[Step 0] Git diff preview: ${diffResult.stdout?.substring(0, 200)}...`)

    if (diffResult.exitCode === 0 && diffResult.stdout.trim() && diffResult.stdout.trim() !== "No git diff available") {
      gitDiff = diffResult.stdout.trim()
      console.log(`[Step 0] ✅ Agent made changes - git diff captured (${gitDiff.length} chars)`)

      // === VERIFICATION STEP ===
      // If the agent made changes, reload the page and capture the new CLS score
      console.log(`[Step 0] Starting verification - reloading page to capture after-fix CLS...`)

      try {
        // Wait a moment for HMR to apply the changes
        console.log(`[Step 0] Waiting 3s for HMR to apply changes...`)
        await new Promise((resolve) => setTimeout(resolve, 3000))

        // Navigate browser to refresh the page (this triggers fresh CLS measurement by d3k)
        console.log(`[Step 0] Triggering browser navigation for fresh CLS measurement...`)
        const navCommand = `curl -s -X POST http://localhost:3684/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"http://localhost:3000"}}}}'`
        const navResult = await runSandboxCommand(sandboxResult.sandbox, "bash", ["-c", navCommand])
        console.log(`[Step 0] Navigation result: exit ${navResult.exitCode}`)

        // Wait for page to load and d3k to capture new CLS metrics
        console.log(`[Step 0] Waiting 5s for page load and CLS measurement...`)
        await new Promise((resolve) => setTimeout(resolve, 5000))

        // Re-fetch d3k artifacts to get updated CLS metadata
        console.log(`[Step 0] Re-fetching d3k artifacts for updated CLS score...`)
        const afterArtifacts = await fetchAndUploadD3kArtifacts(
          sandboxResult.sandbox,
          sandboxResult.mcpUrl,
          `${projectName}-after`
        )

        // Extract the new CLS score from the updated metadata
        if (afterArtifacts.metadata) {
          const afterMeta = afterArtifacts.metadata as { totalCLS?: number; clsGrade?: string }
          const afterClsScore = afterMeta.totalCLS
          console.log(`[Step 0] After-fix artifacts metadata: totalCLS=${afterClsScore}`)

          if (typeof afterClsScore === "number") {
            console.log(`[Step 0] After-fix CLS score: ${afterClsScore}`)

            // Determine verification status
            const beforeScore = clsScore ?? 1.0 // Use captured score or assume bad
            let verificationStatus: "improved" | "unchanged" | "degraded"
            if (afterClsScore < beforeScore * 0.9) {
              verificationStatus = "improved"
            } else if (afterClsScore > beforeScore * 1.1) {
              verificationStatus = "degraded"
            } else {
              verificationStatus = "unchanged"
            }

            const afterClsGrade: "good" | "needs-improvement" | "poor" =
              afterClsScore <= 0.1 ? "good" : afterClsScore <= 0.25 ? "needs-improvement" : "poor"

            console.log(
              `[Step 0] Verification status: ${verificationStatus} (before: ${beforeScore}, after: ${afterClsScore})`
            )

            // Update the report with verification data
            initialReport.afterClsScore = afterClsScore
            initialReport.afterClsGrade = afterClsGrade
            initialReport.verificationStatus = verificationStatus
            await saveReportToBlob(initialReport)
            console.log(`[Step 0] Report updated with verification data`)
          }
        } else {
          console.log(`[Step 0] No metadata in after-fix artifacts - CLS verification not possible`)
        }

        // Capture "after" screenshot
        console.log(`[Step 0] Capturing AFTER screenshot...`)
        const afterBase64 = await captureScreenshotInSandbox(
          sandboxResult.sandbox,
          "http://localhost:3000",
          chromiumPath,
          "after"
        )
        if (afterBase64) {
          const afterScreenshotUrl = await uploadScreenshot(afterBase64, "after", projectName)
          if (afterScreenshotUrl) {
            initialReport.afterScreenshotUrl = afterScreenshotUrl
            await saveReportToBlob(initialReport)
            console.log(`[Step 0] After screenshot uploaded: ${afterScreenshotUrl}`)
          }
        }
      } catch (verifyError) {
        console.log(
          `[Step 0] Verification failed: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`
        )
        initialReport.verificationError = verifyError instanceof Error ? verifyError.message : String(verifyError)
        await saveReportToBlob(initialReport)
      }
    } else {
      console.log(`[Step 0] ⚠️ No git diff detected - skipping verification step`)
      console.log(`[Step 0] This means the agent did not make any file changes`)
    }
  } catch (agentError) {
    console.log(
      `[Step 0] Agent analysis failed: ${agentError instanceof Error ? agentError.message : String(agentError)}`
    )
    agentAnalysis = `Agent analysis failed: ${agentError instanceof Error ? agentError.message : String(agentError)}`
  }

  // Note: We cannot return the cleanup function or sandbox object as they're not serializable
  // Sandbox cleanup will happen automatically when the sandbox times out
  return {
    mcpUrl: sandboxResult.mcpUrl,
    devUrl: sandboxResult.devUrl,
    bypassToken: sandboxResult.bypassToken,
    clsData,
    mcpError,
    beforeScreenshotUrl,
    chromiumPath,
    gitDiff,
    d3kArtifacts,
    reportId,
    reportBlobUrl,
    agentAnalysis
  }
}

/**
 * Run AI agent with sandbox tools
 * This is called from within Step 0 while we have sandbox access
 */
async function runAgentWithSandboxTools(
  sandbox: Sandbox,
  mcpUrl: string,
  devUrl: string,
  logAnalysis: string
): Promise<string> {
  console.log("[Agent] Starting AI agent with d3k sandbox tools...")

  // Create AI Gateway instance
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("anthropic/claude-sonnet-4-20250514")
  const tools = createD3kSandboxTools(sandbox, mcpUrl)

  const systemPrompt = `You are a CLS (Cumulative Layout Shift) specialist engineer working with d3k, a development debugging tool. Your ONLY focus is fixing layout shift issues.

## TOOLS AVAILABLE
You have access to tools to explore and modify the codebase:
- **readFile**: Read source files to understand the code
- **globSearch**: Find files by pattern (e.g., '*.tsx', '**/Header*')
- **grepSearch**: Search for code patterns
- **listDirectory**: Explore project structure
- **findComponentSource**: d3k-specific tool to map DOM elements to React source files
- **writeFile**: Write fixes to files
- **getGitDiff**: Review changes you've made

## WORKFLOW
1. First, understand the CLS issue from the diagnostic data
2. Use findComponentSource or grepSearch to locate the source files
3. Read the relevant files to understand the code
4. Write fixes using writeFile
5. Use getGitDiff to verify your changes
6. Provide a summary of what you fixed

## CLS KNOWLEDGE

CLS (Cumulative Layout Shift) measures visual stability. A good CLS score is 0.1 or less.

### What causes CLS:
1. **Images without dimensions** - <img> tags missing width/height cause layout shifts when images load
2. **Dynamic content insertion** - Content that appears after initial render
3. **Web fonts causing FOIT/FOUT** - Text that shifts when custom fonts load
4. **Async loaded components** - React components rendering after data fetches
5. **Animations that trigger layout** - CSS animations affecting dimensions

### How to fix CLS:
1. **Add width/height to images**: Always specify explicit dimensions or use aspect-ratio
2. **Reserve space**: Use min-height, skeleton loaders, or CSS aspect-ratio
3. **Use font-display**: Prevent font-related shifts with 'optional' or 'swap'
4. **Suspense with sized fallbacks**: Wrap async components with properly sized placeholders
5. **Use transform animations**: Prefer transform/opacity over dimension changes

## OUTPUT FORMAT

After investigating and fixing, provide:

## Summary
[Brief description of what was found and fixed]

## CLS Score
- **Before**: [The measured score from diagnostics]
- **After**: [If you made fixes, call getGitDiff to confirm changes were applied]

## Root Cause
[What element(s) caused the shift and why]

## Fix Applied
[What changes were made]

## Git Diff
\`\`\`diff
[Actual diff from getGitDiff - ALWAYS call this at the end]
\`\`\`

## WORKFLOW REQUIREMENT
After making any fixes, you MUST:
1. Call getGitDiff to verify your changes were applied
2. Report both the BEFORE CLS score (from diagnostics) and confirm changes are ready for verification

## RULES
1. ONLY fix CLS/layout shift issues
2. If CLS score is < 0.05, report "✅ NO CLS ISSUES - Score: [score]"
3. Always read files before modifying them
4. Make minimal, targeted fixes
5. ALWAYS call getGitDiff at the end to confirm your changes`

  const userPrompt = `The dev server is running at: ${devUrl}

Here's the diagnostic data captured from the running application:
${logAnalysis}

Please investigate and fix any CLS issues.`

  const { text, steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    stopWhen: stepCountIs(20) // Allow up to 20 tool call steps
  })

  console.log(`[Agent] Completed in ${steps.length} step(s)`)
  console.log(`[Agent] Final text length: ${text.length} chars`)
  console.log(`[Agent] Text preview: ${text.substring(0, 200)}...`)

  // Log tool usage summary
  const toolCalls = steps.flatMap((s) => s.toolCalls || [])
  if (toolCalls.length > 0) {
    const toolSummary = toolCalls.reduce(
      (acc, tc) => {
        acc[tc.toolName] = (acc[tc.toolName] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
    console.log(`[Agent] Tool usage: ${JSON.stringify(toolSummary)}`)
  }

  // If text is very short, log warning
  if (text.length < 100) {
    console.log(`[Agent] WARNING: Agent returned very short text, may indicate tool-only response`)
  }

  // Build complete transcript including prompt, all tool calls, and responses
  // This provides full visibility into what the agent did
  const transcript: string[] = []

  // Add the system prompt and user prompt
  transcript.push("## System Prompt")
  transcript.push("```")
  transcript.push(systemPrompt)
  transcript.push("```")
  transcript.push("")
  transcript.push("## User Prompt")
  transcript.push("```")
  transcript.push(userPrompt)
  transcript.push("```")
  transcript.push("")
  transcript.push("## Agent Execution")
  transcript.push("")

  // Add each step with tool calls and results
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    transcript.push(`### Step ${i + 1}`)

    // Add assistant text if present
    if (step.text) {
      transcript.push("")
      transcript.push("**Assistant:**")
      transcript.push(step.text)
    }

    // Add tool calls and results
    // AI SDK step structure uses typed tool calls/results - cast to access properties
    if (step.toolCalls && step.toolCalls.length > 0) {
      for (let j = 0; j < step.toolCalls.length; j++) {
        const toolCall = step.toolCalls[j] as unknown as { toolName: string; args?: unknown }
        const toolResult = step.toolResults?.[j] as unknown as { result?: unknown } | undefined

        transcript.push("")
        transcript.push(`**Tool Call: ${toolCall.toolName}**`)
        transcript.push("```json")
        // args can be an object or undefined
        const argsStr = toolCall.args ? JSON.stringify(toolCall.args, null, 2) : "{}"
        transcript.push(argsStr)
        transcript.push("```")

        transcript.push("")
        transcript.push("**Tool Result:**")
        // Get the result - it's directly on the toolResult object
        let resultStr: string
        if (toolResult === undefined) {
          resultStr = "[no result]"
        } else if (toolResult.result === undefined) {
          resultStr = "[undefined]"
        } else if (typeof toolResult.result === "string") {
          resultStr = toolResult.result
        } else {
          resultStr = JSON.stringify(toolResult.result, null, 2) ?? "[null]"
        }

        // Truncate very long results (like file contents) for readability
        if (resultStr.length > 2000) {
          transcript.push("```")
          transcript.push(`${resultStr.substring(0, 2000)}\n... [truncated, ${resultStr.length} chars total]`)
          transcript.push("```")
        } else {
          transcript.push("```")
          transcript.push(resultStr)
          transcript.push("```")
        }
      }
    }

    transcript.push("")
  }

  // Add final output
  transcript.push("## Final Output")
  transcript.push("")
  transcript.push(text)

  const fullTranscript = transcript.join("\n")
  console.log(`[Agent] Full transcript length: ${fullTranscript.length} chars`)

  return fullTranscript
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
  mcpError?: string | null,
  beforeScreenshotUrlFromStep0?: string | null
) {
  "use step"

  // Debug: Log what we received from Step 0
  console.log(`[Step 1] Received clsData: ${clsData ? "truthy" : "falsy"}, type: ${typeof clsData}`)
  if (clsData) {
    console.log(`[Step 1] clsData preview: ${JSON.stringify(clsData).substring(0, 200)}`)
  }

  // If we already have CLS data from Step 0, use it along with the screenshot
  // This early return prevents the long MCP timeout delays
  if (clsData) {
    console.log("[Step 1] ✅ Using CLS data captured in Step 0 (skipping MCP calls)")
    if (beforeScreenshotUrlFromStep0) {
      console.log(`[Step 1] Before screenshot from Step 0: ${beforeScreenshotUrlFromStep0}`)
    }
    return { logAnalysis: JSON.stringify(clsData, null, 2), beforeScreenshotUrl: beforeScreenshotUrlFromStep0 || null }
  }

  console.log("[Step 1] ⚠️ No CLS data from Step 0, will try MCP calls (may timeout)")

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
            // Parse SSE response format: "event: message\ndata: {...}\n\n"
            let toolsData = null
            const lines = toolsText.split("\n")
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  toolsData = JSON.parse(line.substring(6))
                  break
                } catch {
                  // Continue to next line
                }
              }
            }
            // Fallback: try parsing the whole response as JSON (non-SSE format)
            if (!toolsData) {
              toolsData = JSON.parse(toolsText)
            }

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

      // Extract and log page title from HTML
      const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i)
      const pageTitle = titleMatch ? titleMatch[1].trim() : "(no title found)"
      console.log(`[Step 1] HTTP fallback - Page title: "${pageTitle}"`)

      let logAnalysis = `Dev Server URL: ${devUrl}\n`
      logAnalysis += `Page Title: ${pageTitle}\n`
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
 * Uses AI SDK with AI Gateway + d3k sandbox tools for code access
 *
 * When sandbox is provided, the agent can:
 * - Read files to understand the codebase
 * - Search for relevant code with glob/grep
 * - Find component sources via d3k MCP
 * - Write fixes directly to the sandbox
 * - Get git diff of changes
 */
export async function analyzeLogsWithAgent(logAnalysis: string, devUrl: string, sandbox?: Sandbox, mcpUrl?: string) {
  "use step"

  console.log("[Step 2] Invoking AI agent to analyze logs...")
  console.log(`[Step 2] Sandbox available: ${!!sandbox}`)
  console.log(`[Step 2] MCP URL: ${mcpUrl || "not provided"}`)

  // Create AI Gateway instance
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  // Use Claude Sonnet 4 via AI Gateway
  const model = gateway("anthropic/claude-sonnet-4-20250514")

  // Create d3k sandbox tools if sandbox is available
  const tools = sandbox && mcpUrl ? createD3kSandboxTools(sandbox, mcpUrl) : undefined

  const systemPrompt = `You are a CLS (Cumulative Layout Shift) specialist engineer working with d3k, a development debugging tool. Your ONLY focus is fixing layout shift issues.

${
  tools
    ? `## TOOLS AVAILABLE
You have access to tools to explore and modify the codebase:
- **readFile**: Read source files to understand the code
- **globSearch**: Find files by pattern (e.g., '*.tsx', '**/Header*')
- **grepSearch**: Search for code patterns
- **listDirectory**: Explore project structure
- **findComponentSource**: d3k-specific tool to map DOM elements to React source files
- **writeFile**: Write fixes to files
- **getGitDiff**: Review changes you've made

## WORKFLOW
1. First, understand the CLS issue from the diagnostic data
2. Use findComponentSource or grepSearch to locate the source files
3. Read the relevant files to understand the code
4. Write fixes using writeFile
5. Use getGitDiff to verify your changes
6. Provide a summary of what you fixed`
    : `## LIMITED MODE
No sandbox access - you can only analyze the diagnostic data and propose fixes.
You cannot read or modify the actual source code.`
}

## CLS KNOWLEDGE

CLS (Cumulative Layout Shift) measures visual stability. A good CLS score is 0.1 or less.

### What causes CLS:
1. **Images without dimensions** - <img> tags missing width/height cause layout shifts when images load
2. **Dynamic content insertion** - Content that appears after initial render
3. **Web fonts causing FOIT/FOUT** - Text that shifts when custom fonts load
4. **Async loaded components** - React components rendering after data fetches
5. **Animations that trigger layout** - CSS animations affecting dimensions

### How to fix CLS:
1. **Add width/height to images**: Always specify explicit dimensions or use aspect-ratio
2. **Reserve space**: Use min-height, skeleton loaders, or CSS aspect-ratio
3. **Use font-display**: Prevent font-related shifts with 'optional' or 'swap'
4. **Suspense with sized fallbacks**: Wrap async components with properly sized placeholders
5. **Use transform animations**: Prefer transform/opacity over dimension changes

## OUTPUT FORMAT

After investigating and fixing (if tools available), provide:

## Summary
[Brief description of what was found and fixed]

## CLS Score
[The measured score from diagnostics]

## Root Cause
[What element(s) caused the shift and why]

## Fix Applied
[What changes were made, or proposed changes if no sandbox access]

## Git Diff
\`\`\`diff
[Actual diff from getGitDiff, or proposed diff if no sandbox]
\`\`\`

## RULES
1. ONLY fix CLS/layout shift issues
2. If CLS score is < 0.05, report "✅ NO CLS ISSUES - Score: [score]"
3. Always read files before modifying them
4. Make minimal, targeted fixes`

  const userPrompt = `The dev server is running at: ${devUrl}

Here's the diagnostic data captured from the running application:
${logAnalysis}

Please investigate and fix any CLS issues.`

  if (tools) {
    // Agentic mode with tools
    console.log("[Step 2] Running in agentic mode with d3k sandbox tools...")

    const { text, steps } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      tools,
      stopWhen: stepCountIs(20) // Allow up to 20 tool call steps
    })

    console.log(`[Step 2] Agent completed in ${steps.length} step(s)`)
    console.log(`[Step 2] AI agent response (first 500 chars): ${text.substring(0, 500)}...`)

    // Log tool usage summary
    const toolCalls = steps.flatMap((s) => s.toolCalls || [])
    if (toolCalls.length > 0) {
      const toolSummary = toolCalls.reduce(
        (acc, tc) => {
          acc[tc.toolName] = (acc[tc.toolName] || 0) + 1
          return acc
        },
        {} as Record<string, number>
      )
      console.log(`[Step 2] Tool usage: ${JSON.stringify(toolSummary)}`)
    }

    return text
  } else {
    // Non-agentic fallback (no sandbox)
    console.log("[Step 2] Running in limited mode (no sandbox access)...")

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt
    })

    console.log(`[Step 2] AI agent response (first 500 chars): ${text.substring(0, 500)}...`)

    return text
  }
}

/**
 * Step 3: Update the report with AI agent analysis
 * The initial report was saved in Step 0 with CLS data, screenshots, and logs
 * This step updates it with the agent's fix proposal
 */
export async function uploadToBlob(
  fixProposal: string,
  projectName: string,
  _logAnalysis: string,
  sandboxDevUrl: string,
  beforeScreenshotUrl?: string | null,
  gitDiff?: string | null,
  d3kArtifacts?: {
    clsScreenshots: Array<{ label: string; blobUrl: string; timestamp: number }>
    screencastSessionId: string | null
    fullLogs: string | null
    metadata: Record<string, unknown> | null
  },
  runId?: string,
  sandboxMcpUrl?: string,
  agentAnalysisModel?: string
) {
  "use step"

  const reportId = runId || `report-${Date.now()}`
  console.log(`[Step 3] Updating report ${reportId} with agent analysis...`)

  // Extract CLS data from d3kArtifacts metadata
  let clsScore: number | undefined
  let clsGrade: "good" | "needs-improvement" | "poor" | undefined
  let layoutShifts:
    | Array<{
        score: number
        timestamp: number
        elements: string[]
      }>
    | undefined

  if (d3kArtifacts?.metadata) {
    const meta = d3kArtifacts.metadata as {
      totalCLS?: number
      clsGrade?: string
      layoutShifts?: Array<{
        score: number
        timestamp: number
        sources?: Array<{ node?: string }>
      }>
    }
    clsScore = meta.totalCLS
    if (meta.clsGrade === "good" || meta.clsGrade === "needs-improvement" || meta.clsGrade === "poor") {
      clsGrade = meta.clsGrade
    }
    if (meta.layoutShifts) {
      layoutShifts = meta.layoutShifts.map((shift) => ({
        score: shift.score,
        timestamp: shift.timestamp,
        elements: shift.sources?.map((s) => s.node || "unknown").filter(Boolean) || []
      }))
    }
  }

  // Build the complete report with agent analysis
  // Preserve verification data that was saved in Step 0 (afterClsScore, afterScreenshotUrl, etc.)
  // by fetching the existing report first
  let existingReport: Partial<WorkflowReport> = {}
  try {
    const existingBlobUrl = `https://oeyjlew0wdsxgm6o.public.blob.vercel-storage.com/report-${reportId}.json`
    const existingResponse = await fetch(existingBlobUrl)
    if (existingResponse.ok) {
      existingReport = await existingResponse.json()
      console.log(
        `[Step 3] Loaded existing report - has verification data: afterClsScore=${existingReport.afterClsScore}, afterScreenshotUrl=${existingReport.afterScreenshotUrl ? "present" : "absent"}`
      )
    }
  } catch (e) {
    console.log(`[Step 3] Could not load existing report: ${e instanceof Error ? e.message : String(e)}`)
  }

  const report: Partial<WorkflowReport> & { id: string; projectName: string; timestamp: string } = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    sandboxDevUrl,
    sandboxMcpUrl: sandboxMcpUrl || undefined,
    clsScore,
    clsGrade,
    layoutShifts,
    beforeScreenshotUrl: beforeScreenshotUrl || undefined,
    clsScreenshots: d3kArtifacts?.clsScreenshots?.map((s) => ({
      timestamp: s.timestamp,
      blobUrl: s.blobUrl,
      label: s.label
    })),
    agentAnalysis: fixProposal,
    agentAnalysisModel: agentAnalysisModel || undefined,
    d3kLogs: d3kArtifacts?.fullLogs || undefined,
    gitDiff: gitDiff || undefined,
    // Preserve verification data from Step 0
    afterClsScore: existingReport.afterClsScore,
    afterClsGrade: existingReport.afterClsGrade,
    afterScreenshotUrl: existingReport.afterScreenshotUrl,
    verificationStatus: existingReport.verificationStatus,
    verificationError: existingReport.verificationError
  }

  // Log what we're saving
  console.log(`[Step 3] Agent analysis length: ${fixProposal.length} chars`)
  console.log(`[Step 3] Git diff length: ${gitDiff?.length ?? 0} chars`)
  console.log(`[Step 3] Agent model: ${report.agentAnalysisModel ?? "not specified"}`)

  // Save updated report (overwrites the initial report from Step 0)
  const blobUrl = await saveReportToBlob(report)
  console.log(`[Step 3] Report updated: ${blobUrl}`)

  return {
    success: true,
    projectName,
    fixProposal,
    blobUrl,
    beforeScreenshotUrl: beforeScreenshotUrl || null,
    message: "Fix analysis completed and report updated"
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

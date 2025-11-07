import { createGateway, generateText } from "ai"

/**
 * Cloud Fix Workflow - Deployed on Vercel
 *
 * This workflow analyzes logs from a sandbox environment and generates fix proposals.
 * Uses Vercel Workflow SDK for durability and AI Gateway for multi-model support.
 */
export async function POST(request: Request) {
  "use workflow"

  const { mcpUrl, devUrl, projectName } = await request.json()

  console.log("[Workflow] Starting cloud fix workflow...")
  console.log(`[Workflow] MCP URL: ${mcpUrl}`)
  console.log(`[Workflow] Dev URL: ${devUrl}`)
  console.log(`[Workflow] Project: ${projectName}`)
  console.log(`[Workflow] Timestamp: ${new Date().toISOString()}`)

  // Step 1: Fetch log analysis from MCP
  const logAnalysis = await fetchLogAnalysis(mcpUrl)

  // Step 2: Invoke AI agent to analyze logs and create fix
  const fixProposal = await analyzeLogsWithAgent(logAnalysis, devUrl)

  // Step 3: Apply fix and create PR (if applicable)
  const result = await applyFixAndCreatePR(mcpUrl, fixProposal, projectName)

  return Response.json(result)
}

/**
 * Step 1: Fetch log analysis from fix_my_app MCP tool
 */
async function fetchLogAnalysis(mcpUrl: string) {
  "use step"

  console.log("[Step 1] Fetching log analysis from MCP...")

  const response = await fetch(`${mcpUrl}/mcp`, {
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
        arguments: {}
      }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch log analysis: ${response.status} - ${errorText}`)
  }

  // Parse SSE response
  const text = await response.text()
  const lines = text.split("\n")
  let result = ""

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const json = JSON.parse(line.substring(6))
        if (json.result?.content) {
          for (const content of json.result.content) {
            if (content.type === "text") {
              result += content.text
            }
          }
        }
      } catch (_err) {
        // Skip invalid JSON
      }
    }
  }

  console.log(`[Step 1] Log analysis result (first 500 chars): ${result.substring(0, 500)}...`)

  return result
}

/**
 * Step 2: Invoke AI agent to analyze logs and propose fixes
 * Uses AI SDK with AI Gateway for multi-model support
 */
async function analyzeLogsWithAgent(logAnalysis: string, devUrl: string) {
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
4. Explain why this fix will resolve the issue

Format your response as:
## Issue
[Brief description of the issue]

## Root Cause
[Explanation of what's causing the issue]

## Proposed Fix
[Specific file paths and code changes needed]

## Reasoning
[Why this fix will work]

If no errors are found, respond with "No critical issues detected."`

  const { text } = await generateText({
    model,
    prompt
  })

  console.log(`[Step 2] AI agent response (first 500 chars): ${text.substring(0, 500)}...`)

  return text
}

/**
 * Step 3: Apply fix and create PR
 * This would call MCP tools to create the actual PR
 */
async function applyFixAndCreatePR(_mcpUrl: string, fixProposal: string, projectName: string) {
  "use step"

  console.log("[Step 3] Preparing fix results...")

  // For now, just return the fix proposal
  // In the future, this would:
  // 1. Parse the fix proposal
  // 2. Call MCP tools to apply code changes
  // 3. Create a PR via GitHub API

  return {
    success: true,
    projectName,
    fixProposal,
    message: "Fix analysis completed successfully"
  }
}

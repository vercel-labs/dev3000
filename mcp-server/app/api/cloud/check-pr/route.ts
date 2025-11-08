import { put } from "@vercel/blob"
import { createGateway, generateText } from "ai"
import { start } from "workflow/api"

/**
 * Cloud Check PR Workflow Function - Verifies PR changes work as expected
 *
 * This workflow analyzes a PR's changes by:
 * 1. Intelligently determining which pages to check based on changed files
 * 2. Crawling the preview deployment to verify functionality
 * 3. Checking performance metrics
 * 4. Verifying PR description claims match actual behavior
 */
export async function cloudCheckPRWorkflow(params: {
  previewUrl: string
  prTitle: string
  prBody: string
  changedFiles: string[]
  repoOwner: string
  repoName: string
  prNumber: string
}) {
  "use workflow"

  const { previewUrl, prTitle, prBody, changedFiles, repoOwner, repoName, prNumber } = params

  console.log("[Workflow] Starting cloud check-pr workflow...")
  console.log(`[Workflow] Preview URL: ${previewUrl}`)
  console.log(`[Workflow] PR #${prNumber}: ${prTitle}`)
  console.log(`[Workflow] Changed files: ${changedFiles.length}`)
  console.log(`[Workflow] Timestamp: ${new Date().toISOString()}`)

  // Step 1: Determine which pages to check based on changed files
  const pagesToCheck = await identifyAffectedPages(changedFiles, prBody)

  // Step 2: Crawl the preview deployment
  const crawlResults = await crawlPreviewPages(previewUrl, pagesToCheck)

  // Step 3: Verify PR claims against actual behavior
  const verification = await verifyPRClaims(prTitle, prBody, crawlResults, changedFiles)

  // Step 4: Check performance metrics
  const performanceResults = await checkPerformance(previewUrl, pagesToCheck)

  // Step 5: Generate comprehensive report
  const report = await generateReport({
    prTitle,
    prBody,
    prNumber,
    previewUrl,
    changedFiles,
    pagesToCheck,
    crawlResults,
    verification,
    performanceResults,
    repoOwner,
    repoName
  })

  // Step 6: Upload report to blob storage
  const blobResult = await uploadReport(report, repoOwner, repoName, prNumber)

  return Response.json({
    success: verification.allChecksPassed,
    reportUrl: blobResult.blobUrl,
    prComment: true,
    verification: verification.summary,
    performance: performanceResults.summary,
    message: verification.allChecksPassed
      ? "All PR checks passed! ✅"
      : "Some PR checks failed - see report for details"
  })
}

/**
 * Step 1: Identify affected pages based on changed files
 * Uses pattern matching and AI to determine which routes/pages to check
 */
async function identifyAffectedPages(changedFiles: string[], prBody: string) {
  "use step"

  console.log(`[Step 1] Identifying affected pages from ${changedFiles.length} changed files...`)

  // Common patterns to identify page files
  const pagePatterns = [
    /\/pages\/(.*)\.(tsx?|jsx?)$/, // Next.js pages dir
    /\/app\/(.*)\/(page|route)\.(tsx?|jsx?)$/, // Next.js app dir
    /\/routes\/(.*)\.(tsx?|jsx?)$/, // SvelteKit routes
    /\/src\/routes\/(.*)\.(svelte|tsx?|jsx?)$/, // SvelteKit src/routes
    /\.page\.(tsx?|jsx?)$/, // Generic page pattern
    /\.route\.(tsx?|jsx?)$/ // Generic route pattern
  ]

  const detectedPages: string[] = []

  for (const file of changedFiles) {
    for (const pattern of pagePatterns) {
      const match = file.match(pattern)
      if (match) {
        // Convert file path to URL path
        let urlPath = match[1]
        if (!urlPath) urlPath = ""

        // Clean up the path
        urlPath = urlPath
          .replace(/\/index$/, "") // Remove trailing /index
          .replace(/\[([^\]]+)\]/g, ":$1") // Convert [param] to :param for dynamic routes

        // Add leading slash if not present
        if (!urlPath.startsWith("/")) {
          urlPath = `/${urlPath}`
        }

        detectedPages.push(urlPath)
        console.log(`[Step 1] Detected page: ${urlPath} from ${file}`)
      }
    }
  }

  // Always include homepage
  if (!detectedPages.includes("/") && !detectedPages.includes("")) {
    detectedPages.unshift("/")
  }

  // Use AI to extract any URLs mentioned in PR body
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("anthropic/claude-sonnet-4-20250514")

  const prompt = `Extract any page paths or routes mentioned in this PR description:

${prBody}

Return a JSON array of page paths (e.g., ["/about", "/contact", "/api/users"]).
If no specific paths are mentioned, return an empty array: []

Only return the JSON array, nothing else.`

  try {
    const { text } = await generateText({
      model,
      prompt
    })

    const extractedPaths = JSON.parse(text.trim())
    if (Array.isArray(extractedPaths)) {
      for (const path of extractedPaths) {
        if (!detectedPages.includes(path)) {
          detectedPages.push(path)
          console.log(`[Step 1] Extracted path from PR body: ${path}`)
        }
      }
    }
  } catch (error) {
    console.error("[Step 1] Failed to extract paths from PR body:", error)
  }

  console.log(`[Step 1] Total pages to check: ${detectedPages.length}`)
  return detectedPages
}

/**
 * Step 2: Crawl preview deployment pages
 * Fetches each page and captures content, errors, and metadata
 */
async function crawlPreviewPages(previewUrl: string, pagesToCheck: string[]) {
  "use step"

  console.log(`[Step 2] Crawling ${pagesToCheck.length} pages from preview deployment...`)

  const results: Array<{
    path: string
    status: number
    statusText: string
    content: string
    contentLength: number
    errors: string[]
    redirected: boolean
    finalUrl?: string
  }> = []

  for (const path of pagesToCheck) {
    const fullUrl = `${previewUrl}${path}`
    console.log(`[Step 2] Crawling: ${fullUrl}`)

    try {
      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "User-Agent": "dev3000-pr-checker/1.0",
          Accept: "text/html,application/json,*/*"
        },
        redirect: "follow"
      })

      const content = await response.text()
      const errors: string[] = []

      // Check for common error patterns in content
      if (content.includes("ReferenceError") || content.includes("TypeError")) {
        const errorMatch = content.match(/(ReferenceError|TypeError|SyntaxError|Error):[^\n]+/)
        if (errorMatch) {
          errors.push(errorMatch[0])
        }
      }

      results.push({
        path,
        status: response.status,
        statusText: response.statusText,
        content: content.substring(0, 10000), // Limit content length
        contentLength: content.length,
        errors,
        redirected: response.redirected,
        finalUrl: response.redirected ? response.url : undefined
      })

      console.log(
        `[Step 2] ✓ ${path}: ${response.status} (${content.length} bytes${errors.length > 0 ? `, ${errors.length} errors` : ""})`
      )
    } catch (error) {
      console.error(`[Step 2] ✗ ${path}: ${error}`)
      results.push({
        path,
        status: 0,
        statusText: "Failed to fetch",
        content: "",
        contentLength: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        redirected: false
      })
    }
  }

  console.log(`[Step 2] Crawling complete. ${results.length} pages checked.`)
  return results
}

/**
 * Step 3: Verify PR claims against actual behavior
 * Uses AI to compare PR description with actual crawl results
 */
// biome-ignore lint/suspicious/noExplicitAny: AI-generated crawl data has dynamic structure
async function verifyPRClaims(prTitle: string, prBody: string, crawlResults: any[], changedFiles: string[]) {
  "use step"

  console.log("[Step 3] Verifying PR claims against actual behavior...")

  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("anthropic/claude-sonnet-4-20250514")

  const prompt = `You are a QA engineer verifying that a Pull Request's changes work as described.

**PR Title**: ${prTitle}

**PR Description**:
${prBody}

**Changed Files** (${changedFiles.length} files):
${changedFiles.slice(0, 20).join("\n")}
${changedFiles.length > 20 ? `\n... and ${changedFiles.length - 20} more files` : ""}

**Crawl Results** (actual behavior from preview deployment):
${JSON.stringify(crawlResults, null, 2)}

Your task:
1. Identify any specific claims or expected behavior mentioned in the PR title or description
2. Check if the crawl results support or contradict those claims
3. Look for any errors or unexpected behavior in the crawl results
4. Determine if the PR changes are working as intended

Respond with a JSON object in this exact format:
{
  "allChecksPassed": true or false,
  "summary": "Brief summary of verification results",
  "claims": [
    {
      "claim": "The claim from PR description",
      "verified": true or false,
      "evidence": "Evidence from crawl results",
      "status": "pass" or "fail" or "warning"
    }
  ],
  "errors": [
    {
      "page": "/path",
      "error": "Error description",
      "severity": "critical" or "warning"
    }
  ],
  "recommendations": [
    "Specific recommendation based on findings"
  ]
}

Only return valid JSON, nothing else.`

  try {
    const { text } = await generateText({
      model,
      prompt
    })

    const verification = JSON.parse(text.trim())
    console.log(`[Step 3] Verification complete. All checks passed: ${verification.allChecksPassed}`)
    return verification
  } catch (error) {
    console.error("[Step 3] Error during verification:", error)
    return {
      allChecksPassed: false,
      summary: "Failed to verify PR claims due to AI analysis error",
      claims: [],
      errors: [
        {
          page: "N/A",
          error: error instanceof Error ? error.message : String(error),
          severity: "critical"
        }
      ],
      recommendations: ["Re-run the PR check to verify results"]
    }
  }
}

/**
 * Step 4: Check performance metrics
 * Measures page load times and identifies potential performance issues
 */
async function checkPerformance(previewUrl: string, pagesToCheck: string[]) {
  "use step"

  console.log(`[Step 4] Checking performance for ${pagesToCheck.length} pages...`)

  const performanceResults: Array<{
    path: string
    loadTime: number
    contentSize: number
    status: "fast" | "acceptable" | "slow"
  }> = []

  for (const path of pagesToCheck) {
    const fullUrl = `${previewUrl}${path}`

    try {
      const startTime = Date.now()
      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "User-Agent": "dev3000-pr-checker/1.0",
          Accept: "text/html,*/*"
        }
      })
      const content = await response.text()
      const loadTime = Date.now() - startTime

      // Simple performance thresholds
      let status: "fast" | "acceptable" | "slow"
      if (loadTime < 500) status = "fast"
      else if (loadTime < 2000) status = "acceptable"
      else status = "slow"

      performanceResults.push({
        path,
        loadTime,
        contentSize: content.length,
        status
      })

      console.log(`[Step 4] ${path}: ${loadTime}ms (${status})`)
    } catch (error) {
      console.error(`[Step 4] Failed to check performance for ${path}:`, error)
    }
  }

  const avgLoadTime =
    performanceResults.length > 0
      ? performanceResults.reduce((sum, r) => sum + r.loadTime, 0) / performanceResults.length
      : 0

  const slowPages = performanceResults.filter((r) => r.status === "slow")

  console.log(`[Step 4] Performance check complete. Average load time: ${avgLoadTime.toFixed(0)}ms`)

  return {
    results: performanceResults,
    summary: {
      averageLoadTime: avgLoadTime,
      slowPagesCount: slowPages.length,
      slowPages: slowPages.map((p) => p.path)
    }
  }
}

/**
 * Step 5: Generate comprehensive markdown report
 */
// biome-ignore lint/suspicious/noExplicitAny: AI verification results have dynamic structure
// biome-ignore lint/suspicious/noExplicitAny: Performance results have dynamic structure
// biome-ignore lint/suspicious/noExplicitAny: Crawl results have dynamic structure
async function generateReport(data: {
  prTitle: string
  prBody: string
  prNumber: string
  previewUrl: string
  changedFiles: string[]
  pagesToCheck: string[]
  crawlResults: any[]
  verification: any
  performanceResults: any
  repoOwner: string
  repoName: string
}) {
  "use step"

  console.log("[Step 5] Generating comprehensive report...")

  const timestamp = new Date().toISOString()
  const { prTitle, prNumber, previewUrl, changedFiles, verification, performanceResults, repoOwner, repoName } = data

  const statusEmoji = verification.allChecksPassed ? "✅" : "❌"

  const report = `# PR Verification Report ${statusEmoji}

**PR**: [#${prNumber}](https://github.com/${repoOwner}/${repoName}/pull/${prNumber}) - ${prTitle}
**Preview URL**: [${previewUrl}](${previewUrl})
**Generated**: ${timestamp}
**Powered by**: [dev3000](https://github.com/vercel-labs/dev3000) with Claude Code

---

## Summary

${verification.summary}

**Overall Status**: ${verification.allChecksPassed ? "✅ All checks passed" : "❌ Some checks failed"}

---

## Verification Results

${
  verification.claims.length > 0
    ? verification.claims
        // biome-ignore lint/suspicious/noExplicitAny: AI-generated claim objects have dynamic structure
        .map(
          (claim: any) => `
### ${claim.status === "pass" ? "✅" : claim.status === "fail" ? "❌" : "⚠️"} ${claim.claim}

**Status**: ${claim.status.toUpperCase()}

**Evidence**: ${claim.evidence}
`
        )
        .join("\n")
    : "*No specific claims to verify*"
}

---

## Errors Detected

${
  verification.errors.length > 0
    ? verification.errors
        // biome-ignore lint/suspicious/noExplicitAny: AI-generated error objects have dynamic structure
        .map(
          (error: any) => `
### ${error.severity === "critical" ? "🔴" : "🟡"} ${error.page}

\`\`\`
${error.error}
\`\`\`
`
        )
        .join("\n")
    : "✅ No errors detected"
}

---

## Performance Analysis

**Average Load Time**: ${performanceResults.summary.averageLoadTime.toFixed(0)}ms

${
  performanceResults.results.length > 0
    ? `
| Page | Load Time | Status |
|------|-----------|--------|
${performanceResults.results
  // biome-ignore lint/suspicious/noExplicitAny: Performance result objects have dynamic structure
  .map((r: any) => {
    const statusIcon = r.status === "fast" ? "🟢" : r.status === "acceptable" ? "🟡" : "🔴"
    return `| ${r.path} | ${r.loadTime}ms | ${statusIcon} ${r.status} |`
  })
  .join("\n")}
`
    : "*No performance data available*"
}

${
  performanceResults.summary.slowPagesCount > 0
    ? `
### ⚠️ Slow Pages Detected

The following pages took longer than 2 seconds to load:
${performanceResults.summary.slowPages.map((p: string) => `- ${p}`).join("\n")}
`
    : ""
}

---

## Recommendations

${
  verification.recommendations.length > 0
    ? verification.recommendations.map((rec: string) => `- ${rec}`).join("\n")
    : "- No specific recommendations at this time"
}

---

## Changed Files (${changedFiles.length})

<details>
<summary>Click to expand</summary>

${changedFiles.map((file) => `- \`${file}\``).join("\n")}

</details>

---

## Attribution

This PR verification was automatically generated by [dev3000](https://github.com/vercel-labs/dev3000),
an AI-powered development tool that analyzes preview deployments and verifies PR claims.

**Co-Authored-By**: Claude (dev3000) <noreply@anthropic.com>

### About dev3000

dev3000 uses AI to:
- Intelligently identify which pages to check based on changed files
- Crawl preview deployments to verify functionality
- Check performance metrics
- Verify PR description claims match actual behavior
- Generate comprehensive reports

Learn more at https://github.com/vercel-labs/dev3000
`

  return report
}

/**
 * Step 6: Upload report to blob storage
 */
async function uploadReport(report: string, repoOwner: string, repoName: string, prNumber: string) {
  "use step"

  console.log("[Step 6] Uploading report to blob storage...")

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `pr-check-${repoOwner}-${repoName}-pr${prNumber}-${timestamp}.md`

  const blob = await put(filename, report, {
    access: "public",
    contentType: "text/markdown"
  })

  console.log(`[Step 6] Report uploaded to: ${blob.url}`)

  return {
    blobUrl: blob.url,
    filename
  }
}

/**
 * Next.js API Route Handler
 *
 * This is the HTTP POST endpoint that Next.js exposes as /api/cloud/check-pr.
 * It extracts parameters from the Request and calls the workflow function.
 */
export async function POST(request: Request) {
  try {
    const { previewUrl, prTitle, prBody, changedFiles, repoOwner, repoName, prNumber } = await request.json()

    console.log("[POST /api/cloud/check-pr] Starting PR check...")
    console.log(`[POST /api/cloud/check-pr] PR #${prNumber}: ${prTitle}`)
    console.log(`[POST /api/cloud/check-pr] Preview URL: ${previewUrl}`)

    // Start the workflow using the Workflow SDK's start() API
    const run = await start(cloudCheckPRWorkflow, [
      {
        previewUrl,
        prTitle,
        prBody,
        changedFiles,
        repoOwner,
        repoName,
        prNumber
      }
    ])

    console.log(`[POST /api/cloud/check-pr] Workflow started, waiting for completion...`)

    // Wait for workflow to complete and get the Response
    const workflowResponse = await run.returnValue

    // Parse the JSON result from the Response
    const result = await workflowResponse.json()

    console.log("[POST /api/cloud/check-pr] Workflow completed successfully")

    // Return the result
    return Response.json(result)
  } catch (error) {
    console.error("[POST /api/cloud/check-pr] Error:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: "PR check workflow failed - this feature is still in development"
      },
      { status: 500 }
    )
  }
}

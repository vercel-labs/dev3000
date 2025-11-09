/**
 * Step functions for check-pr workflow
 * Separated into their own module to avoid workflow bundler issues
 */

import { put } from "@vercel/blob"
import { createGateway, generateText } from "ai"

/**
 * Step 1: Identify affected pages based on changed files
 */
export async function identifyAffectedPages(changedFiles: string[], prBody: string) {
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
        let pagePath = match[1] || ""
        // Clean up the path
        pagePath = pagePath.replace(/\/(page|route|index)$/, "")
        pagePath = pagePath || "/"
        if (!pagePath.startsWith("/")) {
          pagePath = `/${pagePath}`
        }
        if (!detectedPages.includes(pagePath)) {
          detectedPages.push(pagePath)
        }
        break
      }
    }
  }

  console.log(`[Step 1] Detected ${detectedPages.length} pages from file patterns`)

  // Use AI to analyze PR body for additional pages mentioned
  if (prBody && prBody.length > 10) {
    console.log("[Step 1] Analyzing PR description for mentioned pages...")

    const gateway = createGateway({
      apiKey: process.env.AI_GATEWAY_API_KEY,
      baseURL: "https://ai-gateway.vercel.sh/v1/ai"
    })

    const model = gateway("anthropic/claude-sonnet-4-20250514")

    const aiPrompt = `Analyze this PR description and extract any URL paths or routes that are mentioned or affected.

PR Description:
${prBody}

Changed files:
${changedFiles.join("\n")}

Return ONLY a JSON array of paths (e.g., ["/", "/about", "/api/users"]). If no specific paths are mentioned, return an empty array [].
Do not include explanations, just the JSON array.`

    try {
      const { text } = await generateText({
        model,
        prompt: aiPrompt,
        maxTokens: 500
      })

      // Parse AI response
      const jsonMatch = text.match(/\[.*\]/)
      if (jsonMatch) {
        const aiPages = JSON.parse(jsonMatch[0]) as string[]
        for (const page of aiPages) {
          if (page && !detectedPages.includes(page)) {
            detectedPages.push(page)
          }
        }
        console.log(`[Step 1] AI found ${aiPages.length} additional pages`)
      }
    } catch (error) {
      console.error("[Step 1] AI analysis failed:", error)
    }
  }

  // Always include homepage if nothing else is found
  if (detectedPages.length === 0) {
    console.log("[Step 1] No specific pages detected, checking homepage")
    detectedPages.push("/")
  }

  console.log(`[Step 1] Final pages to check: ${detectedPages.join(", ")}`)
  return detectedPages
}

/**
 * Step 2: Crawl preview deployment pages
 */
export async function crawlPreviewPages(previewUrl: string, pagesToCheck: string[]) {
  "use step"

  console.log(`[Step 2] Crawling ${pagesToCheck.length} pages on ${previewUrl}`)

  const results = []

  for (const page of pagesToCheck) {
    console.log(`[Step 2] Crawling: ${page}`)

    try {
      const fullUrl = `${previewUrl}${page}`
      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "User-Agent": "dev3000-pr-checker/1.0",
          Accept: "text/html,application/json,*/*"
        }
      })

      const contentType = response.headers.get("content-type") || ""
      const isHtml = contentType.includes("text/html")
      const isJson = contentType.includes("application/json")

      let content = ""
      let bodyPreview = ""

      if (isHtml || isJson) {
        content = await response.text()
        // Get first 1000 chars as preview
        bodyPreview = content.substring(0, 1000)
      }

      results.push({
        page,
        url: fullUrl,
        status: response.status,
        statusText: response.statusText,
        contentType,
        bodyPreview,
        headers: Object.fromEntries(response.headers.entries())
      })

      console.log(`[Step 2] ${page}: ${response.status} ${response.statusText}`)
    } catch (error) {
      console.error(`[Step 2] Failed to crawl ${page}:`, error)
      results.push({
        page,
        url: `${previewUrl}${page}`,
        status: 0,
        statusText: "Fetch failed",
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  console.log(`[Step 2] Crawled ${results.length} pages`)
  return results
}

/**
 * Step 3: Verify PR claims against actual behavior
 */
// biome-ignore lint/suspicious/noExplicitAny: AI-generated crawl data has dynamic structure
export async function verifyPRClaims(prTitle: string, prBody: string, crawlResults: any[], changedFiles: string[]) {
  "use step"

  console.log("[Step 3] Verifying PR claims against actual behavior...")

  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("anthropic/claude-sonnet-4-20250514")

  const aiPrompt = `You are verifying a Pull Request for accuracy. Compare the PR's claims with the actual deployment behavior.

PR Title: ${prTitle}

PR Description:
${prBody}

Changed Files:
${changedFiles.join("\n")}

Crawl Results from Preview Deployment:
${JSON.stringify(crawlResults, null, 2)}

Your task:
1. Analyze whether the PR's claimed changes match the actual behavior shown in the crawl results
2. Check if pages load successfully (200 status codes)
3. Identify any errors or unexpected behavior
4. Verify the changes work as described

Respond in this exact JSON format:
{
  "allChecksPassed": boolean,
  "summary": "Brief summary of findings",
  "details": {
    "claimsVerified": ["List of claims that were verified"],
    "issues": ["List of any issues found"],
    "warnings": ["List of warnings"]
  }
}

Only return valid JSON, no additional text.`

  try {
    const { text } = await generateText({
      model,
      prompt: aiPrompt,
      maxTokens: 1500
    })

    // Parse AI response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const verification = JSON.parse(jsonMatch[0])
      console.log(`[Step 3] Verification complete: ${verification.allChecksPassed ? "PASSED" : "FAILED"}`)
      return verification
    }

    console.error("[Step 3] Failed to parse AI response")
    return {
      allChecksPassed: false,
      summary: "Verification failed - could not parse AI response",
      details: {
        claimsVerified: [],
        issues: ["AI verification returned invalid format"],
        warnings: []
      }
    }
  } catch (error) {
    console.error("[Step 3] Verification failed:", error)
    return {
      allChecksPassed: false,
      summary: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        claimsVerified: [],
        issues: [error instanceof Error ? error.message : String(error)],
        warnings: []
      }
    }
  }
}

/**
 * Step 4: Check performance metrics
 */
export async function checkPerformance(previewUrl: string, pagesToCheck: string[]) {
  "use step"

  console.log(`[Step 4] Checking performance for ${pagesToCheck.length} pages`)

  const performanceResults = []

  for (const page of pagesToCheck) {
    console.log(`[Step 4] Measuring performance: ${page}`)

    try {
      const fullUrl = `${previewUrl}${page}`
      const startTime = Date.now()

      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "User-Agent": "dev3000-pr-checker/1.0",
          Accept: "text/html,*/*"
        }
      })

      const endTime = Date.now()
      const loadTime = endTime - startTime

      const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10)

      performanceResults.push({
        page,
        loadTime,
        contentLength,
        status: response.status,
        isSlow: loadTime > 2000 // Consider >2s as slow
      })

      console.log(`[Step 4] ${page}: ${loadTime}ms, ${contentLength} bytes`)
    } catch (error) {
      console.error(`[Step 4] Performance check failed for ${page}:`, error)
      performanceResults.push({
        page,
        loadTime: 0,
        contentLength: 0,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        isSlow: false
      })
    }
  }

  const slowPages = performanceResults.filter((r) => r.isSlow)

  console.log(`[Step 4] Performance check complete. ${slowPages.length} slow pages found.`)

  return {
    results: performanceResults,
    slowPagesCount: slowPages.length,
    summary: {
      avgLoadTime: performanceResults.reduce((sum, r) => sum + r.loadTime, 0) / performanceResults.length,
      slowPages: slowPages.map((r) => r.page)
    }
  }
}

/**
 * Step 5: Generate comprehensive report
 */
// biome-ignore lint/suspicious/noExplicitAny: Report data has dynamic structure from previous steps
export async function generateReport(data: any) {
  "use step"

  console.log("[Step 5] Generating comprehensive report...")

  const {
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
  } = data

  let report = `# PR Verification Report\n\n`
  report += `**PR**: #${prNumber} - ${prTitle}\n`
  report += `**Repository**: ${repoOwner}/${repoName}\n`
  report += `**Preview URL**: ${previewUrl}\n`
  report += `**Timestamp**: ${new Date().toISOString()}\n\n`

  report += `## Summary\n\n`
  report += `${verification.allChecksPassed ? "✅" : "❌"} ${verification.summary}\n\n`

  report += `## Changed Files\n\n`
  for (const file of changedFiles) {
    report += `- ${file}\n`
  }
  report += `\n`

  report += `## Pages Checked\n\n`
  for (const page of pagesToCheck) {
    report += `- ${page}\n`
  }
  report += `\n`

  report += `## Verification Results\n\n`
  if (verification.details.claimsVerified.length > 0) {
    report += `### Claims Verified ✅\n\n`
    for (const claim of verification.details.claimsVerified) {
      report += `- ${claim}\n`
    }
    report += `\n`
  }

  if (verification.details.issues.length > 0) {
    report += `### Issues Found ❌\n\n`
    for (const issue of verification.details.issues) {
      report += `- ${issue}\n`
    }
    report += `\n`
  }

  if (verification.details.warnings.length > 0) {
    report += `### Warnings ⚠️\n\n`
    for (const warning of verification.details.warnings) {
      report += `- ${warning}\n`
    }
    report += `\n`
  }

  report += `## Crawl Results\n\n`
  for (const result of crawlResults) {
    const statusEmoji = result.status === 200 ? "✅" : result.status >= 400 ? "❌" : "⚠️"
    report += `### ${statusEmoji} ${result.page}\n\n`
    report += `- **URL**: ${result.url}\n`
    report += `- **Status**: ${result.status} ${result.statusText}\n`
    if (result.contentType) {
      report += `- **Content-Type**: ${result.contentType}\n`
    }
    if (result.error) {
      report += `- **Error**: ${result.error}\n`
    }
    report += `\n`
  }

  report += `## Performance Analysis\n\n`
  report += `**Average Load Time**: ${Math.round(performanceResults.summary.avgLoadTime)}ms\n\n`

  if (performanceResults.slowPagesCount > 0) {
    report += `⚠️ **Slow Pages** (>2s):\n`
    for (const page of performanceResults.summary.slowPages) {
      report += `- ${page}\n`
    }
    report += `\n`
  } else {
    report += `✅ All pages loaded in under 2 seconds\n\n`
  }

  report += `### Detailed Metrics\n\n`
  for (const result of performanceResults.results) {
    report += `- **${result.page}**: ${result.loadTime}ms (${result.contentLength} bytes)\n`
  }
  report += `\n`

  report += `## PR Description\n\n`
  report += `${prBody || "(No description provided)"}\n\n`

  report += `---\n\n`
  report += `*Generated by dev3000 PR Checker*\n`

  console.log(`[Step 5] Report generated (${report.length} characters)`)
  return report
}

/**
 * Step 6: Upload report to blob storage
 */
export async function uploadReport(report: string, repoOwner: string, repoName: string, prNumber: string) {
  "use step"

  console.log("[Step 6] Uploading report to blob storage...")

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `pr-check-${repoOwner}-${repoName}-pr${prNumber}-${timestamp}.md`

  const blob = await put(filename, report, {
    access: "public",
    contentType: "text/markdown"
  })

  console.log(`[Step 6] Report uploaded: ${blob.url}`)

  return {
    blobUrl: blob.url,
    filename
  }
}

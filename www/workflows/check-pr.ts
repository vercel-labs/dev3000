/**
 * Check PR Workflow - Verifies PR changes work as expected
 *
 * This workflow is in a separate file from the route to avoid bundler issues.
 * The workflow function analyzes PR changes by:
 * 1. Intelligently determining which pages to check based on changed files
 * 2. Crawling the preview deployment to verify functionality
 * 3. Checking performance metrics
 * 4. Verifying PR description claims match actual behavior
 *
 * IMPORTANT: No imports at the top level! All imports must be inside step functions
 * to avoid Node.js module detection by the workflow bundler.
 */

export async function cloudCheckPRWorkflow(
  previewUrl: string,
  prTitle: string,
  prBody: string,
  changedFiles: string[],
  repoOwner: string,
  repoName: string,
  prNumber: string
) {
  "use workflow"

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

  return {
    success: verification.allChecksPassed,
    reportUrl: blobResult.blobUrl,
    prComment: true,
    verification: verification.summary,
    performance: performanceResults.summary,
    message: verification.allChecksPassed
      ? "All PR checks passed! ✅"
      : "Some PR checks failed - see report for details"
  }
}

// Step wrapper functions that dynamically import the actual implementations
// This avoids bundler issues with Node.js modules

type ReportData = {
  prTitle: string
  prBody: string
  prNumber: string
  previewUrl: string
  changedFiles: string[]
  pagesToCheck: string[]
  crawlResults: Array<{
    page: string
    url: string
    status: number
    statusText: string
    contentType?: string
    error?: string
  }>
  verification: {
    allChecksPassed: boolean
    summary: string
    details: {
      claimsVerified: string[]
      issues: string[]
      warnings: string[]
    }
  }
  performanceResults: {
    results: Array<{ page: string; loadTime: number; contentLength: number; isSlow: boolean }>
    slowPagesCount: number
    summary: { avgLoadTime: number; slowPages: string[] }
  }
  repoOwner: string
  repoName: string
}

async function identifyAffectedPages(changedFiles: string[], prBody: string) {
  "use step"
  const steps = await import("../app/api/cloud/check-pr/steps")
  return steps.identifyAffectedPages(changedFiles, prBody)
}

async function crawlPreviewPages(previewUrl: string, pagesToCheck: string[]) {
  "use step"
  const steps = await import("../app/api/cloud/check-pr/steps")
  return steps.crawlPreviewPages(previewUrl, pagesToCheck)
}

async function verifyPRClaims(prTitle: string, prBody: string, crawlResults: unknown[], changedFiles: string[]) {
  "use step"
  const steps = await import("../app/api/cloud/check-pr/steps")
  return steps.verifyPRClaims(prTitle, prBody, crawlResults, changedFiles)
}

async function checkPerformance(previewUrl: string, pagesToCheck: string[]) {
  "use step"
  const steps = await import("../app/api/cloud/check-pr/steps")
  return steps.checkPerformance(previewUrl, pagesToCheck)
}

async function generateReport(data: ReportData) {
  "use step"
  const steps = await import("../app/api/cloud/check-pr/steps")
  return steps.generateReport(data)
}

async function uploadReport(report: string, repoOwner: string, repoName: string, prNumber: string) {
  "use step"
  const steps = await import("../app/api/cloud/check-pr/steps")
  return steps.uploadReport(report, repoOwner, repoName, prNumber)
}

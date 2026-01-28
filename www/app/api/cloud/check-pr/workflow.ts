/**
 * Cloud Check PR Workflow Function - Core workflow logic
 *
 * This file contains ONLY the workflow function and step wrappers.
 * It does NOT import workflow/api to avoid bundler issues.
 */

/**
 * Main workflow function that checks a PR's changes
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
  const pagesToCheck = await identifyAffectedPagesStep(changedFiles, prBody)

  // Step 2: Crawl the preview deployment
  const crawlResults = await crawlPreviewPagesStep(previewUrl, pagesToCheck)

  // Step 3: Verify PR claims against actual behavior
  const verification = await verifyPRClaimsStep(prTitle, prBody, crawlResults, changedFiles)

  // Step 4: Check performance metrics
  const performanceResults = await checkPerformanceStep(previewUrl, pagesToCheck)

  // Step 5: Generate comprehensive report
  const report = await generateReportStep({
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
  const blobResult = await uploadReportStep(report, repoOwner, repoName, prNumber)

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

// Step function wrappers that dynamically import the actual implementations
async function identifyAffectedPagesStep(changedFiles: string[], prBody: string) {
  "use step"
  const { identifyAffectedPages } = await import("./steps")
  return identifyAffectedPages(changedFiles, prBody)
}

async function crawlPreviewPagesStep(previewUrl: string, pagesToCheck: string[]) {
  "use step"
  const { crawlPreviewPages } = await import("./steps")
  return crawlPreviewPages(previewUrl, pagesToCheck)
}

// biome-ignore lint/suspicious/noExplicitAny: AI-generated crawl data has dynamic structure
async function verifyPRClaimsStep(prTitle: string, prBody: string, crawlResults: any[], changedFiles: string[]) {
  "use step"
  const { verifyPRClaims } = await import("./steps")
  return verifyPRClaims(prTitle, prBody, crawlResults, changedFiles)
}

async function checkPerformanceStep(previewUrl: string, pagesToCheck: string[]) {
  "use step"
  const { checkPerformance } = await import("./steps")
  return checkPerformance(previewUrl, pagesToCheck)
}

// biome-ignore lint/suspicious/noExplicitAny: Report data has dynamic structure from previous steps
async function generateReportStep(data: any) {
  "use step"
  const { generateReport } = await import("./steps")
  return generateReport(data)
}

async function uploadReportStep(report: string, repoOwner: string, repoName: string, prNumber: string) {
  "use step"
  const { uploadReport } = await import("./steps")
  return uploadReport(report, repoOwner, repoName, prNumber)
}

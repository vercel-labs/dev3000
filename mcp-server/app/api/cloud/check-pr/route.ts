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

/**
 * POST /api/cloud/check-pr
 * HTTP endpoint that starts the workflow
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { previewUrl, prTitle, prBody, changedFiles, repoOwner, repoName, prNumber } = body

    // Validate required fields
    if (!previewUrl || !prTitle || !repoOwner || !repoName || !prNumber) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    console.log(`[API] Starting PR check for ${repoOwner}/${repoName}#${prNumber}`)

    // Start the workflow
    const workflowRun = await start(cloudCheckPRWorkflow, {
      previewUrl,
      prTitle,
      prBody: prBody || "",
      changedFiles: changedFiles || [],
      repoOwner,
      repoName,
      prNumber: String(prNumber)
    })

    console.log(`[API] Workflow started: ${workflowRun.id}`)

    // Wait for workflow to complete (workflows are durable and will continue even if this times out)
    const result = await workflowRun.result()

    console.log(`[API] Workflow completed: ${result.status}`)

    return result
  } catch (error) {
    console.error("[API] Error starting workflow:", error)
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

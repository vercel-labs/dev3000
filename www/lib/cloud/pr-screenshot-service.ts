/**
 * PR Screenshot Service - Captures before/after screenshots for PR visual comparison
 *
 * Takes screenshots of production (before) and localhost (after) for routes
 * affected by changes, uploads them to blob storage for embedding in PR body.
 */

import { put } from "@vercel/blob"
import type { Sandbox } from "@vercel/sandbox"
import { SandboxAgentBrowser } from "./sandbox-agent-browser"

const log = (msg: string) => console.log(`[PRScreenshots] ${msg}`)

export interface PRScreenshotOptions {
  sandbox: Sandbox
  productionUrl: string // e.g., "https://myapp.vercel.app"
  localhostUrl: string // e.g., "http://localhost:3000"
  routes: string[] // e.g., ["/", "/about"]
  projectName: string
}

export interface PRScreenshotResult {
  route: string
  beforeBlobUrl: string | null
  afterBlobUrl: string | null
  error?: string
}

/**
 * Capture before/after screenshots for the given routes.
 * - "Before" = production URL
 * - "After" = localhost URL
 *
 * Screenshots are uploaded to Vercel Blob for public access in PR body.
 */
export async function captureBeforeAfterScreenshots(options: PRScreenshotOptions): Promise<PRScreenshotResult[]> {
  const { sandbox, productionUrl, localhostUrl, routes, projectName } = options
  const results: PRScreenshotResult[] = []

  if (routes.length === 0) {
    log("No routes to screenshot")
    return results
  }

  log(`Capturing screenshots for ${routes.length} route(s): ${routes.join(", ")}`)
  log(`Production URL: ${productionUrl}`)
  log(`Localhost URL: ${localhostUrl}`)

  // Create browser instance
  let browser: SandboxAgentBrowser | null = null
  try {
    browser = await SandboxAgentBrowser.create(sandbox, {
      profile: "/tmp/pr-screenshots-profile",
      debug: true
    })
  } catch (err) {
    log(`Failed to create browser: ${err instanceof Error ? err.message : String(err)}`)
    return routes.map((route) => ({
      route,
      beforeBlobUrl: null,
      afterBlobUrl: null,
      error: "Failed to create browser"
    }))
  }

  const timestamp = Date.now()

  for (const route of routes) {
    const result: PRScreenshotResult = {
      route,
      beforeBlobUrl: null,
      afterBlobUrl: null
    }

    try {
      // Capture "before" screenshot from production
      const beforeUrl = new URL(route, productionUrl).toString()
      log(`Capturing BEFORE: ${beforeUrl}`)

      const beforePath = `/tmp/pr-before-${timestamp}-${sanitizeRoute(route)}.png`
      const openBeforeResult = await browser.open(beforeUrl)

      if (openBeforeResult.success) {
        // Wait for page to settle
        await sleep(2000)

        const screenshotBeforeResult = await browser.screenshot(beforePath, { fullPage: false })
        if (screenshotBeforeResult.success) {
          // Upload to blob storage
          const beforeBlobUrl = await uploadScreenshotToBlob(sandbox, beforePath, projectName, "before", route)
          result.beforeBlobUrl = beforeBlobUrl
          log(`BEFORE uploaded: ${beforeBlobUrl}`)
        } else {
          log(`BEFORE screenshot failed: ${screenshotBeforeResult.error}`)
        }
      } else {
        log(`BEFORE navigation failed: ${openBeforeResult.error}`)
        // Production might not have this route yet (new page)
        result.error = "Page may not exist in production"
      }

      // Capture "after" screenshot from localhost
      const afterUrl = new URL(route, localhostUrl).toString()
      log(`Capturing AFTER: ${afterUrl}`)

      const afterPath = `/tmp/pr-after-${timestamp}-${sanitizeRoute(route)}.png`
      const openAfterResult = await browser.open(afterUrl)

      if (openAfterResult.success) {
        // Wait for page to settle
        await sleep(2000)

        const screenshotAfterResult = await browser.screenshot(afterPath, { fullPage: false })
        if (screenshotAfterResult.success) {
          // Upload to blob storage
          const afterBlobUrl = await uploadScreenshotToBlob(sandbox, afterPath, projectName, "after", route)
          result.afterBlobUrl = afterBlobUrl
          log(`AFTER uploaded: ${afterBlobUrl}`)
        } else {
          log(`AFTER screenshot failed: ${screenshotAfterResult.error}`)
        }
      } else {
        log(`AFTER navigation failed: ${openAfterResult.error}`)
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      log(`Error capturing route ${route}: ${result.error}`)
    }

    results.push(result)
  }

  // Close browser
  try {
    await browser.close()
  } catch {
    // Ignore close errors
  }

  return results
}

/**
 * Upload a screenshot from the sandbox to Vercel Blob storage
 */
async function uploadScreenshotToBlob(
  sandbox: Sandbox,
  screenshotPath: string,
  projectName: string,
  type: "before" | "after",
  route: string
): Promise<string | null> {
  try {
    // Read the screenshot file from sandbox
    const catResult = await sandbox.runCommand({
      cmd: "cat",
      args: [screenshotPath]
    })

    // Collect binary data
    const chunks: Buffer[] = []
    for await (const log of catResult.logs()) {
      if (log.stream === "stdout") {
        chunks.push(Buffer.from(log.data, "binary"))
      }
    }
    await catResult.wait()

    if (catResult.exitCode !== 0 || chunks.length === 0) {
      return null
    }

    const imageBuffer = Buffer.concat(chunks)

    // Upload to blob storage
    const blobName = `pr-${projectName}-${type}-${sanitizeRoute(route)}-${Date.now()}.png`
    const blob = await put(blobName, imageBuffer, {
      access: "public",
      contentType: "image/png"
    })

    return blob.url
  } catch (err) {
    log(`Failed to upload screenshot: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Sanitize a route for use in filenames
 */
function sanitizeRoute(route: string): string {
  return (
    route
      .replace(/^\//, "") // Remove leading slash
      .replace(/\//g, "-") // Replace slashes with dashes
      .replace(/[^a-zA-Z0-9-]/g, "") // Remove special chars
      .substring(0, 50) || // Limit length
    "root"
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

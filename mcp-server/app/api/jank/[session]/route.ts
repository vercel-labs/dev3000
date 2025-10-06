import { existsSync, readdirSync, readFileSync } from "fs"
import { type NextRequest, NextResponse } from "next/server"
import { tmpdir } from "os"
import { join } from "path"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"

/**
 * Fetch real CLS data from screencast metadata
 * ScreencastManager now injects a PerformanceObserver to capture real layout shifts
 */
async function getRealCLSData(
  screenshotDir: string,
  session: string
): Promise<{
  shifts: Array<{ score: number; timestamp: number; sources?: unknown[] }>
  totalCLS: number
  grade: string
  cssViewport?: { width: number; height: number; devicePixelRatio: number }
} | null> {
  try {
    const metadataPath = join(screenshotDir, `${session}-metadata.json`)
    if (!existsSync(metadataPath)) {
      return null
    }

    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"))
    if (!metadata.layoutShifts || metadata.layoutShifts.length === 0) {
      return null
    }

    return {
      shifts: metadata.layoutShifts,
      totalCLS: metadata.totalCLS || 0,
      grade: metadata.clsGrade || "unknown",
      cssViewport: metadata.cssViewport
    }
  } catch (error) {
    console.error("Failed to fetch real CLS data:", error)
    return null
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ session: string }> }) {
  const { session } = await params
  const screenshotDir = process.env.SCREENSHOT_DIR || join(tmpdir(), "dev3000-mcp-deps", "public", "screenshots")

  // Try to get real CLS data from screencast metadata
  const realCLS = await getRealCLSData(screenshotDir, session)

  if (realCLS && realCLS.shifts.length === 0) {
    // No layout shifts detected by PerformanceObserver
    return NextResponse.json({
      clsMarkers: [],
      source: "performance-observer",
      actualCLS: 0,
      grade: "good",
      message: "No layout shifts detected by PerformanceObserver"
    })
  }

  if (!existsSync(screenshotDir)) {
    return NextResponse.json({ clsMarkers: [] })
  }

  // Find files for this session
  const files = readdirSync(screenshotDir)
  const sessionFiles = files
    .filter((f) => f.startsWith(session) && f.includes("-jank-") && f.endsWith(".png"))
    .sort((a, b) => {
      const aTime = parseInt(a.match(/-(\d+)ms\.png$/)?.[1] || "0", 10)
      const bTime = parseInt(b.match(/-(\d+)ms\.png$/)?.[1] || "0", 10)
      return aTime - bTime
    })

  if (sessionFiles.length < 2) {
    return NextResponse.json({ clsMarkers: [] })
  }

  const clsMarkers: Array<{
    timestamp: number
    boundingBox: { x: number; y: number; width: number; height: number } | null
  }> = []

  const debugInfo: Array<{
    comparison: string
    diffPercentage: number
    shiftRegions?: number
    isValid: boolean
  }> = []

  // Compare consecutive frames
  for (let i = 1; i < sessionFiles.length; i++) {
    const prevFile = join(screenshotDir, sessionFiles[i - 1])
    const currFile = join(screenshotDir, sessionFiles[i])

    try {
      const prevPng = PNG.sync.read(readFileSync(prevFile))
      const currPng = PNG.sync.read(readFileSync(currFile))

      if (prevPng.width !== currPng.width || prevPng.height !== currPng.height) {
        continue
      }

      const diff = new PNG({ width: prevPng.width, height: prevPng.height })
      const numDiffPixels = pixelmatch(prevPng.data, currPng.data, diff.data, prevPng.width, prevPng.height, {
        threshold: 0.1
      })

      const totalPixels = prevPng.width * prevPng.height
      const diffPercentage = (numDiffPixels / totalPixels) * 100

      // Skip if almost no changes (< 0.05% = likely just anti-aliasing)
      if (diffPercentage < 0.05) {
        continue
      }

      // Detect LAYOUT SHIFTS by looking for horizontal bands of changes
      // (content moving down/up will create horizontal bands of differences)
      const rowChangeCounts = new Array(prevPng.height).fill(0)

      for (let y = 0; y < prevPng.height; y++) {
        for (let x = 0; x < prevPng.width; x++) {
          const idx = (prevPng.width * y + x) * 4
          if (diff.data[idx] > 0 || diff.data[idx + 1] > 0 || diff.data[idx + 2] > 0) {
            rowChangeCounts[y]++
          }
        }
      }

      // Find regions with significant row changes (indicating vertical shifts)
      let shiftRegions: Array<{ startY: number; endY: number; intensity: number }> = []
      let currentRegionStart = -1
      let currentRegionIntensity = 0

      for (let y = 0; y < prevPng.height; y++) {
        const rowChangePercentage = (rowChangeCounts[y] / prevPng.width) * 100

        // If this row has significant changes (>10% of pixels in the row changed)
        if (rowChangePercentage > 10) {
          if (currentRegionStart === -1) {
            currentRegionStart = y
            currentRegionIntensity = rowChangePercentage
          } else {
            currentRegionIntensity = Math.max(currentRegionIntensity, rowChangePercentage)
          }
        } else if (currentRegionStart !== -1) {
          // End of a shift region
          shiftRegions.push({
            startY: currentRegionStart,
            endY: y - 1,
            intensity: currentRegionIntensity
          })
          currentRegionStart = -1
          currentRegionIntensity = 0
        }
      }

      // Close final region if needed
      if (currentRegionStart !== -1) {
        shiftRegions.push({
          startY: currentRegionStart,
          endY: prevPng.height - 1,
          intensity: currentRegionIntensity
        })
      }

      // Filter shift regions: must be at least 5px tall and have high intensity
      shiftRegions = shiftRegions.filter((region) => {
        const height = region.endY - region.startY
        return height >= 5 && region.intensity > 20
      })

      // If we found layout shift regions, calculate bounding box
      if (shiftRegions.length > 0) {
        let minX = prevPng.width
        let minY = prevPng.height
        let maxX = 0
        let maxY = 0

        for (const region of shiftRegions) {
          for (let y = region.startY; y <= region.endY; y++) {
            for (let x = 0; x < prevPng.width; x++) {
              const idx = (prevPng.width * y + x) * 4
              if (diff.data[idx] > 0 || diff.data[idx + 1] > 0 || diff.data[idx + 2] > 0) {
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x)
                maxY = Math.max(maxY, y)
              }
            }
          }
        }

        // Collect debug info
        debugInfo.push({
          comparison: `${sessionFiles[i - 1]} vs ${sessionFiles[i]}`,
          diffPercentage: Number.parseFloat(diffPercentage.toFixed(2)),
          shiftRegions: shiftRegions.length,
          isValid: true
        })

        if (minX < maxX && minY < maxY) {
          const timeMatch = sessionFiles[i].match(/-(\d+)ms\.png$/)
          const timeSinceStart = timeMatch ? parseInt(timeMatch[1], 10) : 0

          // Add padding to bounding box (10px)
          const padding = 10
          const boundingBox = {
            x: Math.max(0, minX - padding),
            y: Math.max(0, minY - padding),
            width: Math.min(prevPng.width, maxX - minX + padding * 2),
            height: Math.min(prevPng.height, maxY - minY + padding * 2)
          }

          // Only include bounding box if it's reasonable (< 50% of screen)
          // If it's too large, the detection is likely inaccurate
          const boxArea = boundingBox.width * boundingBox.height
          const screenArea = prevPng.width * prevPng.height
          const areaPercentage = (boxArea / screenArea) * 100
          const boundingBoxToUse = boxArea < screenArea * 0.5 ? boundingBox : null

          console.log("[JANK API] Pixel-diff bounding box:", {
            boundingBox,
            areaPercentage: `${areaPercentage.toFixed(2)}%`,
            rejected: !boundingBoxToUse,
            reason: !boundingBoxToUse ? "too large (>50% of screen)" : "accepted"
          })

          clsMarkers.push({ timestamp: timeSinceStart, boundingBox: boundingBoxToUse })
        }
      } else {
        // No shift regions found - likely just content changes (images loading)
        debugInfo.push({
          comparison: `${sessionFiles[i - 1]} vs ${sessionFiles[i]}`,
          diffPercentage: Number.parseFloat(diffPercentage.toFixed(2)),
          shiftRegions: 0,
          isValid: false
        })
      }
    } catch {
      // Skip frames that can't be compared
    }
  }

  // Get screenshot dimensions to calculate coordinate scaling
  let screenshotWidth = 1920 // default
  let screenshotHeight = 1080 // default
  if (sessionFiles.length > 0) {
    try {
      const firstScreenshot = PNG.sync.read(readFileSync(join(screenshotDir, sessionFiles[0])))
      screenshotWidth = firstScreenshot.width
      screenshotHeight = firstScreenshot.height
    } catch {
      // Use defaults
    }
  }

  // If we have real CLS data, cross-reference with pixel-diff to filter false positives
  if (realCLS) {
    // Match each real CLS shift to the closest pixel-diff marker
    // This avoids duplicate markers for the same shift
    const filteredMarkers = realCLS.shifts
      .map((shift) => {
        // Find closest pixel-diff marker within 50ms
        let closestMarker = null
        let closestDistance = Infinity

        for (const marker of clsMarkers) {
          const distance = Math.abs(shift.timestamp - marker.timestamp)
          if (distance < 50 && distance < closestDistance) {
            closestMarker = marker
            closestDistance = distance
          }
        }

        if (!closestMarker) return null

        // Try to use real CLS bounding box if available
        const source = shift.sources?.[0] as {
          node?: string
          previousRect?: { x: number; y: number; width: number; height: number }
          currentRect?: { x: number; y: number; width: number; height: number }
          actualRect?: { x: number; y: number; width: number; height: number }
        }
        let boundingBox = closestMarker.boundingBox

        // Prefer actualRect (queried via querySelector) - it's in CSS pixels relative to viewport
        // Convert to screenshot pixels using CSS viewport dimensions
        if (source?.actualRect && realCLS?.cssViewport) {
          const cssRect = source.actualRect
          const cssViewportWidth = realCLS.cssViewport.width
          const cssViewportHeight = realCLS.cssViewport.height

          console.log("[JANK API] actualRect (CSS pixels):", cssRect)
          console.log("[JANK API] CSS viewport:", { width: cssViewportWidth, height: cssViewportHeight })
          console.log("[JANK API] Screenshot dimensions:", { width: screenshotWidth, height: screenshotHeight })

          // Calculate scale factor: screenshot pixels / CSS pixels
          const scaleX = screenshotWidth / cssViewportWidth
          const scaleY = screenshotHeight / cssViewportHeight

          console.log("[JANK API] Calculated scale:", { x: scaleX.toFixed(3), y: scaleY.toFixed(3) })

          // Convert CSS pixels to screenshot pixels
          boundingBox = {
            x: Math.round(cssRect.x * scaleX),
            y: Math.round(cssRect.y * scaleY),
            width: Math.round(cssRect.width * scaleX),
            height: Math.round(cssRect.height * scaleY)
          }

          console.log("[JANK API] Bounding box (screenshot pixels):", boundingBox)
        } else {
          console.log("[JANK API] No actualRect or cssViewport available, cannot determine bounding box")
        }

        return {
          ...closestMarker,
          boundingBox,
          clsScore: shift.score,
          element: source?.node || "unknown"
        }
      })
      .filter(Boolean)

    return NextResponse.json({
      clsMarkers: filteredMarkers,
      realLayoutShifts: realCLS.shifts,
      debug: debugInfo,
      source: "performance-observer-validated",
      actualCLS: realCLS.totalCLS,
      grade: realCLS.grade,
      note: `Real CLS: ${realCLS.totalCLS.toFixed(4)} (${realCLS.grade}). Filtered ${clsMarkers.length - filteredMarkers.length} false positives from pixel-diff.`
    })
  }

  return NextResponse.json({
    clsMarkers,
    debug: debugInfo,
    source: "pixel-diff-fallback",
    note: "PerformanceObserver data not available, using pixel-diff analysis (may include false positives)"
  })
}

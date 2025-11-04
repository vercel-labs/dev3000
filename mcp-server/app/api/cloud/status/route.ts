import { NextResponse } from "next/server"
import type { CloudStatus } from "../../../../lib/cloud/types"

/**
 * Cloud Status API
 *
 * Returns overall status of cloud monitoring and reproduction workflows
 *
 * GET /api/cloud/status
 */

// Import the errors map from detect endpoint
// Note: This is a simplified approach for POC. Phase 2 will use proper shared storage
let errors: Map<string, any> | undefined
let reproductions: Map<string, any> | undefined

try {
  // Dynamic import to avoid circular dependencies
  const detectModule = await import("../detect/route")
  errors = detectModule.errors
} catch {
  errors = new Map()
}

try {
  const reproduceModule = await import("../reproduce/route")
  reproductions = reproduceModule.reproductions
} catch {
  reproductions = new Map()
}

export async function GET() {
  try {
    const allErrors = Array.from(errors?.values() || [])
    const allReproductions = Array.from(reproductions?.values() || [])

    const status: CloudStatus = {
      totalErrors: allErrors.length,
      unreproduced: allErrors.filter((e) => !e.reproduced).length,
      reproductions: {
        pending: allReproductions.filter((r) => r.status === "pending").length,
        running: allReproductions.filter((r) => r.status === "running").length,
        completed: allReproductions.filter((r) => r.status === "completed").length,
        failed: allReproductions.filter((r) => r.status === "failed").length
      },
      recentErrors: allErrors.slice(0, 10).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    }

    return NextResponse.json(status)
  } catch (err) {
    console.error("[Cloud] Error in status endpoint:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

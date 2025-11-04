import { randomUUID } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { createSandboxManager } from "../../../../lib/cloud/sandbox-manager"
import type { ProductionError, ReproductionRequest, ReproductionResult } from "../../../../lib/cloud/types"

/**
 * Cloud Error Reproduction API
 *
 * Triggers reproduction of a detected error in Vercel Sandbox
 *
 * POST /api/cloud/reproduce
 * Body: { errorId, repoUrl?, branch? }
 */

// In-memory storage for POC
export const reproductions: Map<string, ReproductionResult> = new Map()

// Import errors from detect endpoint
let errors: Map<string, ProductionError> | undefined
try {
  const detectModule = await import("../detect/route")
  errors = detectModule.errors
} catch {
  errors = new Map()
}

export async function POST(request: NextRequest) {
  try {
    const body: ReproductionRequest = await request.json()

    if (!body.errorId) {
      return NextResponse.json({ error: "Missing required field: errorId" }, { status: 400 })
    }

    // Check if error exists
    const error = errors?.get(body.errorId)
    if (!error) {
      return NextResponse.json({ error: "Error not found" }, { status: 404 })
    }

    // Create reproduction record
    const reproduction: ReproductionResult = {
      id: randomUUID(),
      errorId: body.errorId,
      status: "pending",
      startedAt: new Date().toISOString()
    }

    reproductions.set(reproduction.id, reproduction)

    console.log(`[Cloud] Reproduction queued: ${reproduction.id} for error ${body.errorId}`)

    // Start async reproduction in Vercel Sandbox
    // Note: In production, this should use Vercel Queues or Workflow for better durability
    setImmediate(async () => {
      try {
        reproduction.status = "running"
        reproductions.set(reproduction.id, reproduction)
        console.log(`[Cloud] Starting sandbox reproduction: ${reproduction.id}`)

        // Create sandbox manager and run reproduction
        const sandboxManager = createSandboxManager()
        const result = await sandboxManager.reproduceError(error)

        // Update reproduction with results
        reproduction.status = result.success ? "completed" : "failed"
        reproduction.completedAt = new Date().toISOString()
        reproduction.analysis = result.analysis
        reproduction.logs = result.logs
        reproduction.error = result.error
        reproductions.set(reproduction.id, reproduction)

        // Mark error as reproduced if successful
        if (result.success && errors) {
          error.reproduced = true
          error.reproductionId = reproduction.id
          errors.set(body.errorId, error)
        }

        console.log(
          `[Cloud] Reproduction ${result.success ? "completed" : "failed"}: ${reproduction.id} (${result.duration}ms)`
        )
      } catch (err) {
        reproduction.status = "failed"
        reproduction.error = err instanceof Error ? err.message : "Unknown error"
        reproduction.completedAt = new Date().toISOString()
        reproductions.set(reproduction.id, reproduction)
        console.error(`[Cloud] Reproduction failed: ${reproduction.id}`, err)
      }
    })

    return NextResponse.json({
      success: true,
      reproductionId: reproduction.id,
      message: "Reproduction queued"
    })
  } catch (err) {
    console.error("[Cloud] Error in reproduce endpoint:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// GET endpoint to retrieve reproduction results
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const reproductionId = searchParams.get("id")

    if (reproductionId) {
      const reproduction = reproductions.get(reproductionId)
      if (!reproduction) {
        return NextResponse.json({ error: "Reproduction not found" }, { status: 404 })
      }
      return NextResponse.json(reproduction)
    }

    // Return all reproductions
    const allReproductions = Array.from(reproductions.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )

    return NextResponse.json({
      total: allReproductions.length,
      reproductions: allReproductions
    })
  } catch (err) {
    console.error("[Cloud] Error in reproduce GET endpoint:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

import { randomUUID } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import type { ReproductionRequest, ReproductionResult } from "../../../../lib/cloud/types"

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
let errors: Map<string, any> | undefined
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

    // In Phase 1, we'll just mark as pending
    // Phase 2 will actually spin up Vercel Sandbox
    // For now, simulate async processing
    setTimeout(async () => {
      try {
        reproduction.status = "running"
        reproductions.set(reproduction.id, reproduction)

        // TODO: Actually run in Vercel Sandbox
        // const result = await runInSandbox(error, body)

        // Simulate completion
        reproduction.status = "completed"
        reproduction.completedAt = new Date().toISOString()
        reproduction.analysis = `Error reproduced: ${error.message}`
        reproduction.logs = "Simulated log output from sandbox"
        reproductions.set(reproduction.id, reproduction)

        // Mark error as reproduced
        if (errors) {
          error.reproduced = true
          error.reproductionId = reproduction.id
          errors.set(body.errorId, error)
        }

        console.log(`[Cloud] Reproduction completed: ${reproduction.id}`)
      } catch (err) {
        reproduction.status = "failed"
        reproduction.error = err instanceof Error ? err.message : "Unknown error"
        reproduction.completedAt = new Date().toISOString()
        reproductions.set(reproduction.id, reproduction)
        console.error(`[Cloud] Reproduction failed: ${reproduction.id}`, err)
      }
    }, 2000) // Simulate 2s processing

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

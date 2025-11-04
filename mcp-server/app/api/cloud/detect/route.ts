import { randomUUID } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import type { ProductionError } from "../../../../lib/cloud/types"

/**
 * Cloud Error Detection API
 *
 * Receives error reports from production sites and stores them for reproduction
 *
 * POST /api/cloud/detect
 * Body: { message, stack, url, userAgent, interactions?, severity? }
 */

// In-memory storage for POC (Phase 2 will use proper database)
const errors: Map<string, ProductionError> = new Map()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate required fields
    if (!body.message || !body.url) {
      return NextResponse.json({ error: "Missing required fields: message, url" }, { status: 400 })
    }

    // Create error record
    const error: ProductionError = {
      id: randomUUID(),
      timestamp: body.timestamp || new Date().toISOString(),
      message: body.message,
      stack: body.stack,
      url: body.url,
      userAgent: body.userAgent || "unknown",
      interactions: body.interactions || [],
      severity: body.severity || "error",
      reproduced: false
    }

    // Store error
    errors.set(error.id, error)

    console.log(`[Cloud] New error detected: ${error.id}`)
    console.log(`[Cloud] Message: ${error.message}`)
    console.log(`[Cloud] URL: ${error.url}`)

    return NextResponse.json({
      success: true,
      errorId: error.id,
      message: "Error recorded successfully"
    })
  } catch (err) {
    console.error("[Cloud] Error in detect endpoint:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// GET endpoint to retrieve errors (for dashboard)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const errorId = searchParams.get("id")

    if (errorId) {
      const error = errors.get(errorId)
      if (!error) {
        return NextResponse.json({ error: "Error not found" }, { status: 404 })
      }
      return NextResponse.json(error)
    }

    // Return all errors (most recent first)
    const allErrors = Array.from(errors.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    return NextResponse.json({
      total: allErrors.length,
      errors: allErrors
    })
  } catch (err) {
    console.error("[Cloud] Error in detect GET endpoint:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Export errors map for use by other endpoints
export { errors }

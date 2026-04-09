import { getCurrentUser } from "@/lib/auth"
import { searchSkillRunnerCandidates } from "@/lib/skill-runners"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ success: false, error: "Unauthorized", results: [] }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim() || ""

  if (query.length < 2) {
    return Response.json({ success: true, results: [] })
  }

  try {
    const results = await searchSkillRunnerCandidates(query)
    return Response.json({ success: true, results })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        results: []
      },
      { status: 500 }
    )
  }
}

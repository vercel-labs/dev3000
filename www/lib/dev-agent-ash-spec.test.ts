import { describe, expect, it } from "vitest"

import { createDevAgentAshSource } from "./dev-agent-ash-spec"

describe("createDevAgentAshSource", () => {
  it("disables planning-only todo tool in generated automation packages", async () => {
    const source = await createDevAgentAshSource(
      {
        id: "vercel-optimize",
        name: "Vercel Optimize",
        description: "Run an optimization report.",
        instructions: "Create a report.",
        executionMode: "preview-pr",
        sandboxBrowser: "none",
        skillRefs: [],
        createdAt: "2026-05-26T00:00:00.000Z"
      },
      1
    )

    const todoTool = source.files.find((file) => file.path === "agent/tools/todo.ts")
    expect(todoTool?.content).toContain("disableTool()")
  })
})

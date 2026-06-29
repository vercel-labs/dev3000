import { describe, expect, it } from "vitest"

import { createDevAgentEveSource } from "./dev-agent-eve-spec"

describe("createDevAgentEveSource", () => {
  it("generates an Eve-compatible runner package", async () => {
    const source = await createDevAgentEveSource(
      {
        id: "vercel-optimize",
        name: "Vercel Optimize",
        description: "Run an optimization report.",
        instructions: "Create a report.",
        executionMode: "preview-pr",
        sandboxBrowser: "none",
        skillRefs: [],
        createdAt: "2026-06-05T00:00:00.000Z"
      },
      1
    )

    const packageJson = JSON.parse(source.files.find((file) => file.path === "package.json")?.content || "{}") as {
      dependencies?: Record<string, string>
    }
    const sandbox = source.files.find((file) => file.path === "agent/sandbox/sandbox.ts")?.content || ""
    const eveChannel = source.files.find((file) => file.path === "agent/channels/eve.ts")?.content || ""
    const dev3000Channel = source.files.find((file) => file.path === "agent/channels/dev3000.ts")?.content || ""

    expect(packageJson.dependencies?.eve).toBe("0.17.0")
    expect(packageJson.dependencies?.ai).toBe("^7.0.0")
    expect(source.files.some((file) => file.path === "agent/instructions.md")).toBe(true)
    expect(source.files.some((file) => file.path.startsWith("agent/system"))).toBe(false)
    expect(eveChannel).toContain('from "eve/channels/eve"')
    expect(dev3000Channel).toContain("defineChannel")
    expect(dev3000Channel).toContain('"/eve/v1/dev3000/task"')
    expect(sandbox).toContain('from "eve/sandbox"')
    expect(sandbox).toContain("sandbox.run({ command:")
    expect(sandbox).not.toContain("runCommand")
    expect(sandbox).not.toContain("eve/sandboxes")
  })

  it("disables planning-only todo tool in generated automation packages", async () => {
    const source = await createDevAgentEveSource(
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

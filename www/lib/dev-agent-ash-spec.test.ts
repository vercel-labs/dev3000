import { describe, expect, it } from "vitest"

import { createDevAgentAshSource } from "./dev-agent-ash-spec"

describe("createDevAgentAshSource", () => {
  it("generates an ASH 0.61-compatible runner package", async () => {
    const source = await createDevAgentAshSource(
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
    const ashChannel = source.files.find((file) => file.path === "agent/channels/ash.ts")?.content || ""
    const dev3000Channel = source.files.find((file) => file.path === "agent/channels/dev3000.ts")?.content || ""

    expect(packageJson.dependencies?.["experimental-ash"]).toBe("0.61.0")
    expect(packageJson.dependencies?.ai).toBe("7.0.0-canary.159")
    expect(source.files.some((file) => file.path === "agent/instructions.md")).toBe(true)
    expect(source.files.some((file) => file.path.startsWith("agent/system"))).toBe(false)
    expect(ashChannel).toContain('from "experimental-ash/channels/ash"')
    expect(dev3000Channel).toContain("defineChannel")
    expect(dev3000Channel).toContain('"/.well-known/ash/v1/task"')
    expect(sandbox).toContain('from "experimental-ash/sandbox"')
    expect(sandbox).toContain("sandbox.run({ command:")
    expect(sandbox).not.toContain("runCommand")
    expect(sandbox).not.toContain("experimental-ash/sandboxes")
  })

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

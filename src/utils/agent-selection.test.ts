import { describe, expect, it } from "vitest"
import { getAgentByName, KNOWN_AGENTS } from "./agent-selection.js"

describe("agent-selection", () => {
  it("should use plain quoted d3k prompt for codex variants", () => {
    const codex = getAgentByName("codex")
    const codexYolo = getAgentByName("codex-yolo")

    expect(codex?.command).toContain('"load the d3k skill and await further instruction"')
    expect(codexYolo?.command).toContain('"load the d3k skill and await further instruction"')
  })

  it("should not include legacy escaped single-quote prompt sequences", () => {
    const commands = KNOWN_AGENTS.map((agent) => agent.command).filter((command): command is string => Boolean(command))
    const hasLegacyEscaping = commands.some((command) => command.includes("'\\''"))

    expect(hasLegacyEscaping).toBe(false)
  })
})

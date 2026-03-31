import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getProjectMetadataPath, readProjectAgentName, rememberProjectAgentName } from "./project-metadata.js"
import { getProjectDir } from "./project-name.js"

describe("project metadata", () => {
  let tempHome = ""
  let tempProject = ""
  const originalHome = process.env.HOME

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "d3k-project-metadata-home-"))
    tempProject = mkdtempSync(join(tmpdir(), "d3k-project-metadata-project-"))
    process.env.HOME = tempHome
  })

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }
    rmSync(tempHome, { recursive: true, force: true })
    rmSync(tempProject, { recursive: true, force: true })
  })

  it("remembers the last agent in project metadata", () => {
    rememberProjectAgentName("codex-yolo", tempProject)

    expect(readProjectAgentName(tempProject)).toBe("codex-yolo")
  })

  it("prefers the active session agent over stored project metadata", () => {
    const projectDir = getProjectDir(tempProject)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(getProjectMetadataPath(tempProject), JSON.stringify({ lastAgentName: "claude" }))
    writeFileSync(join(projectDir, "session.json"), JSON.stringify({ agentName: "codex" }))

    expect(readProjectAgentName(tempProject)).toBe("codex")
  })
})

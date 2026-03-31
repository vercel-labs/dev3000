import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { homedir, tmpdir } from "os"
import { join } from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getProjectDir } from "../utils/project-name.js"
import { getResumeLaunchSpec, readProjectAgentName, resolveResumeAgentName } from "./resume.js"

const originalHome = process.env.HOME

describe("resume command", () => {
  let tempHome = ""
  let tempProject = ""

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "d3k-resume-home-"))
    tempProject = mkdtempSync(join(tmpdir(), "d3k-resume-project-"))
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

  it("reads the last agent name from the project session file", () => {
    const projectDir = getProjectDir(tempProject)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, "session.json"), JSON.stringify({ agentName: "codex-yolo" }))

    expect(readProjectAgentName(tempProject)).toBe("codex-yolo")
  })

  it("reads the last agent name from project metadata after the session file is gone", () => {
    const projectDir = getProjectDir(tempProject)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, "project.json"), JSON.stringify({ lastAgentName: "codex-yolo" }))

    expect(readProjectAgentName(tempProject)).toBe("codex-yolo")
  })

  it("falls back to the global default agent when the project session has no agent", () => {
    writeFileSync(join(homedir(), ".d3k.json"), JSON.stringify({ defaultAgent: { name: "claude", command: "claude" } }))

    expect(resolveResumeAgentName(tempProject)).toBe("claude")
  })

  it("prefers the project session agent over the global default", () => {
    const projectDir = getProjectDir(tempProject)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, "session.json"), JSON.stringify({ agentName: "codex" }))
    writeFileSync(join(homedir(), ".d3k.json"), JSON.stringify({ defaultAgent: { name: "claude", command: "claude" } }))

    expect(resolveResumeAgentName(tempProject)).toBe("codex")
  })

  it("builds a codex resume command scoped to the current working directory", () => {
    expect(getResumeLaunchSpec("codex", "/tmp/my-project")).toEqual({
      agentName: "codex",
      binary: "codex",
      args: ["resume", "--last", "-C", "/tmp/my-project"]
    })
  })

  it("builds a claude yolo resume command", () => {
    expect(getResumeLaunchSpec("claude-yolo", "/tmp/my-project")).toEqual({
      agentName: "claude-yolo",
      binary: "claude",
      args: ["--dangerously-skip-permissions", "-c"]
    })
  })

  it("returns null for unsupported agents", () => {
    expect(getResumeLaunchSpec("cursor-agent", "/tmp/my-project")).toBeNull()
  })
})

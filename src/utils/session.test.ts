import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getProjectName } from "./project-name"
import { findCurrentSession } from "./session"

const originalHome = process.env.HOME
const originalDataDir = process.env.D3K_DATA_DIR

function writeSession(dir: string, session: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "session.json"), JSON.stringify(session))
}

describe("session discovery", () => {
  let tempHome = ""

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "d3k-session-test-"))
    process.env.HOME = tempHome
    delete process.env.D3K_DATA_DIR
  })

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalDataDir === undefined) {
      delete process.env.D3K_DATA_DIR
    } else {
      process.env.D3K_DATA_DIR = originalDataDir
    }
    rmSync(tempHome, { recursive: true, force: true })
  })

  it("prefers the current project's active session over a newer session", () => {
    const currentProject = getProjectName()
    writeSession(join(tempHome, ".d3k", "other-project"), {
      projectName: "other-project",
      pid: process.pid,
      startTime: "2026-05-01T18:00:00.000Z",
      logFilePath: "/tmp/other.log"
    })
    writeSession(join(tempHome, ".d3k", currentProject), {
      projectName: currentProject,
      pid: process.pid,
      startTime: "2026-05-01T17:00:00.000Z",
      logFilePath: "/tmp/current.log"
    })

    expect(findCurrentSession()?.logFilePath).toBe("/tmp/current.log")
  })

  it("prefers an explicit D3K_DATA_DIR session", () => {
    const dataDir = join(tempHome, "custom-data")
    process.env.D3K_DATA_DIR = dataDir

    writeSession(join(tempHome, ".d3k", "other-project"), {
      projectName: "other-project",
      pid: process.pid,
      startTime: "2026-05-01T18:00:00.000Z",
      logFilePath: "/tmp/other.log"
    })
    writeSession(dataDir, {
      projectName: "custom-project",
      pid: process.pid,
      startTime: "2026-05-01T17:00:00.000Z",
      logFilePath: "/tmp/custom.log"
    })

    expect(findCurrentSession()?.logFilePath).toBe("/tmp/custom.log")
  })

  it("does not fall back to another project's active session", () => {
    writeSession(join(tempHome, ".d3k", "other-project"), {
      projectName: "other-project",
      pid: process.pid,
      startTime: "2026-05-01T18:00:00.000Z",
      logFilePath: "/tmp/other.log"
    })

    expect(findCurrentSession()).toBeNull()
  })
})

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { getWorkerProjectReadiness, getWorkerProjectSetupExplanation, shouldUseRemoteSkillRunner } from "./skill-runner"

describe("shouldUseRemoteSkillRunner", () => {
  it("uses remote execution for explicit non-DeepSec skill runs", () => {
    expect(
      shouldUseRemoteSkillRunner("vercel-optimize", {
        team: "elsigh-pro",
        project: "cranio-mom"
      })
    ).toBe(true)
  })

  it("does not shadow local skill content without run options when no project is linked", () => {
    const originalCwd = process.cwd()
    const directory = mkdtempSync(join(tmpdir(), "d3k-skill-runner-test-"))
    try {
      process.chdir(directory)
      expect(shouldUseRemoteSkillRunner("vercel-optimize", {})).toBe(false)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("keeps DeepSec remote execution available with explicit run options", () => {
    expect(
      shouldUseRemoteSkillRunner("deepsec", {
        team: "elsigh-pro",
        project: "cranio-mom"
      })
    ).toBe(true)
  })
})

describe("getWorkerProjectReadiness", () => {
  it("requires setup when the team runner is missing", () => {
    expect(
      getWorkerProjectReadiness({
        success: true,
        installed: false,
        message: "No d3k-skill-runner project found in elsigh-pro."
      })
    ).toEqual({
      ready: false,
      message: "No d3k-skill-runner project found in elsigh-pro."
    })
  })

  it("accepts a ready runner project", () => {
    expect(
      getWorkerProjectReadiness({
        success: true,
        installed: true,
        project: {
          workerBaseUrl: "https://d3k-skill-runner.example.vercel.app",
          shellVersionStatus: "current"
        },
        settings: {
          workerStatus: "ready"
        }
      })
    ).toEqual({
      ready: true,
      message: "Team skill runner project is ready."
    })
  })

  it("requires setup for stale or broken runner projects", () => {
    expect(
      getWorkerProjectReadiness({
        success: true,
        installed: true,
        project: {
          workerBaseUrl: "https://d3k-skill-runner.example.vercel.app",
          shellVersionStatus: "outdated"
        },
        settings: {
          workerStatus: "ready"
        }
      }).ready
    ).toBe(false)

    expect(
      getWorkerProjectReadiness({
        success: true,
        installed: true,
        project: {
          workerBaseUrl: "https://d3k-skill-runner.example.vercel.app",
          missingEnvKeys: ["BLOB_READ_WRITE_TOKEN"]
        },
        settings: {
          workerStatus: "ready"
        }
      }).ready
    ).toBe(false)
  })
})

describe("getWorkerProjectSetupExplanation", () => {
  it("explains why the team runner project is needed", () => {
    expect(getWorkerProjectSetupExplanation("elsigh-pro")).toEqual([
      "d3k-skill-runner creates a small runner project in elsigh-pro. Skill runs execute there so compute, AI Gateway usage, deployments, and runtime logs belong to the team running the scan.",
      "For first-time setup, choose all projects in this team when Vercel asks for project access. Single-project grants cannot include the new runner project."
    ])
  })
})

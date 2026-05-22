import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { shouldUseRemoteSkillRunner } from "./skill-runner"

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

import { afterEach, describe, expect, it } from "vitest"

import { isSelfHostedSkillRunnerRuntime } from "./skill-runner-runtime"

const ENV_KEYS = [
  "VERCEL",
  "VERCEL_ORG_ID",
  "VERCEL_TEAM_ID",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "NEXT_PUBLIC_VERCEL_URL"
] as const

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

function clearRuntimeEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

describe("isSelfHostedSkillRunnerRuntime", () => {
  it("does not classify every Vercel deployment as a self-hosted runner when owner env is missing", () => {
    clearRuntimeEnv()
    process.env.VERCEL = "1"
    process.env.VERCEL_URL = "dev3000-ai.vercel.app"

    expect(isSelfHostedSkillRunnerRuntime()).toBe(false)
  })

  it("classifies d3k-skill-runner deployments as self-hosted when owner env is missing", () => {
    clearRuntimeEnv()
    process.env.VERCEL = "1"
    process.env.VERCEL_URL = "d3k-skill-runner-abc123.vercel.app"

    expect(isSelfHostedSkillRunnerRuntime()).toBe(true)
  })

  it("keeps hosted control-plane teams out of self-hosted mode", () => {
    clearRuntimeEnv()
    process.env.VERCEL = "1"
    process.env.VERCEL_ORG_ID = "team_nLlpyC6REAqxydlFKbrMDlud"

    expect(isSelfHostedSkillRunnerRuntime()).toBe(false)
  })
})

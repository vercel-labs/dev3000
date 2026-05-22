import { describe, expect, it } from "vitest"

import {
  buildVercelCliSandboxEnv,
  buildVercelProjectJsonContent,
  normalizeVercelCliSandboxContext
} from "./vercel-cli-sandbox-context"

describe("vercel CLI sandbox context", () => {
  it("normalizes blank values", () => {
    expect(
      normalizeVercelCliSandboxContext({
        projectId: " prj_123 ",
        teamId: " ",
        token: ""
      })
    ).toEqual({
      projectId: "prj_123",
      teamId: undefined,
      token: undefined
    })
  })

  it("builds the process env used by the Vercel CLI", () => {
    expect(
      buildVercelCliSandboxEnv({
        projectId: "prj_123",
        teamId: "team_123",
        token: "secret-token"
      })
    ).toEqual({
      VERCEL_ORG_ID: "team_123",
      VERCEL_PROJECT_ID: "prj_123",
      VERCEL_TEAM_ID: "team_123",
      VERCEL_TOKEN: "secret-token"
    })
  })

  it("writes linked project metadata without token material", () => {
    const content = buildVercelProjectJsonContent({
      projectId: "prj_123",
      teamId: "team_123",
      token: "secret-token"
    })

    expect(content).toBe('{\n  "projectId": "prj_123",\n  "orgId": "team_123"\n}\n')
    expect(content).not.toContain("secret-token")
  })

  it("does not write project metadata without a target project id", () => {
    expect(buildVercelProjectJsonContent({ teamId: "team_123", token: "secret-token" })).toBeNull()
  })
})

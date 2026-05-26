import { describe, expect, it } from "vitest"

import { describeOidcClaimsForLog, getOidcSandboxBinding, isOidcTokenBoundToProject } from "./oidc-token-binding"

function makeJwt(payload: Record<string, unknown>) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `header.${encodedPayload}.signature`
}

describe("OIDC token binding", () => {
  const token = makeJwt({
    owner_id: "team_current",
    project_id: "prj_current",
    owner: "elsigh-pro",
    project: "d3k-skill-runner",
    environment: "production"
  })

  it("extracts project and team bindings", () => {
    expect(getOidcSandboxBinding(token)).toEqual({
      projectId: "prj_current",
      teamId: "team_current"
    })
  })

  it("accepts tokens bound to the expected runtime project", () => {
    expect(isOidcTokenBoundToProject(token, { projectId: "prj_current", teamId: "team_current" })).toBe(true)
  })

  it("rejects stale tokens from a deleted runner project", () => {
    expect(isOidcTokenBoundToProject(token, { projectId: "prj_new", teamId: "team_current" })).toBe(false)
  })

  it("rejects malformed tokens", () => {
    expect(isOidcTokenBoundToProject("not-a-jwt", { projectId: "prj_current", teamId: "team_current" })).toBe(false)
  })

  it("keeps log descriptions limited to non-secret claims", () => {
    expect(describeOidcClaimsForLog(token)).toMatchObject({
      ownerId: "team_current",
      projectId: "prj_current",
      owner: "elsigh-pro",
      project: "d3k-skill-runner",
      environment: "production"
    })
  })
})

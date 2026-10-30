import { describe, expect, it } from "vitest"
import { admittedVercelIdentity, hostedConfig, selectedProject } from "./config"

describe("hosted pilot access", () => {
  it("requires the exact immutable Vercel subject, rather than an email or another provider", () => {
    expect(admittedVercelIdentity("vercel", "owner-id", "owner-id")).toBe(true)
    expect(admittedVercelIdentity("github", "owner-id", "owner-id")).toBe(false)
    expect(admittedVercelIdentity("vercel", "someone-else", "owner-id")).toBe(false)
    expect(admittedVercelIdentity("vercel", undefined, "owner-id")).toBe(false)
  })
  it("refuses to start without explicit deployment configuration", () => {
    expect(() => hostedConfig({})).toThrow("D3K_HOSTED_ORIGIN")
  })
  it("does not allow arbitrary projects to use the service credential", () => {
    const projects = [{ slug: "test/app", teamId: "team_test", projectId: "prj_test" }]
    expect(selectedProject(projects, "test/app").projectId).toBe("prj_test")
    expect(() => selectedProject(projects, "test/another-app")).toThrow("not enabled")
    expect(() => selectedProject(projects, "https://evil.example")).toThrow("not enabled")
  })
})

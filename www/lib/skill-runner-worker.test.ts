import { afterEach, describe, expect, it, vi } from "vitest"

import { installSkillRunnerWorkerProject, resolveSkillRunnerWorkerStatus } from "./skill-runner-worker"

describe("installSkillRunnerWorkerProject", () => {
  const team = { id: "team_test", slug: "test", name: "Test", isPersonal: false }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("propagates access errors without trying to create a runner", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(installSkillRunnerWorkerProject("test-token", team)).rejects.toThrow(
      "Failed to validate runner install: 403 Forbidden"
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("normalizes a rejected lookup without retrying it as a missing project", async () => {
    const fetchMock = vi.fn().mockRejectedValue("network unavailable")
    vi.stubGlobal("fetch", fetchMock)

    await expect(installSkillRunnerWorkerProject("test-token", team)).rejects.toThrow("network unavailable")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("resolveSkillRunnerWorkerStatus", () => {
  it("marks a ready deployment as ready", () => {
    expect(
      resolveSkillRunnerWorkerStatus({
        workerBaseUrl: "https://d3k-skill-runner.example.com",
        missingEnvKeys: [],
        latestDeploymentReadyState: "READY",
        shellVersionStatus: "current"
      })
    ).toBe("ready")
  })

  it("marks failed latest deployments as error even when an older worker URL exists", () => {
    expect(
      resolveSkillRunnerWorkerStatus({
        workerBaseUrl: "https://d3k-skill-runner.example.com",
        missingEnvKeys: [],
        latestDeploymentReadyState: "ERROR",
        shellVersionStatus: "current"
      })
    ).toBe("error")
  })

  it("marks in-progress latest deployments as provisioning", () => {
    expect(
      resolveSkillRunnerWorkerStatus({
        workerBaseUrl: "https://d3k-skill-runner.example.com",
        missingEnvKeys: [],
        latestDeploymentReadyState: "BUILDING",
        shellVersionStatus: "current"
      })
    ).toBe("provisioning")
  })
})

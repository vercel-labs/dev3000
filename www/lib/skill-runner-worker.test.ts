import { describe, expect, it } from "vitest"

import { resolveSkillRunnerWorkerStatus } from "./skill-runner-worker"

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

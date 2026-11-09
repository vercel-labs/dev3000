import { describe, expect, it, vi } from "vitest"
import { sandboxGitCredentials } from "./sandbox-git.js"
import type { runSandboxCli } from "./sandbox-process.js"

const project = { id: "project-a", accountId: "team-a", link: { repoId: 123 } }
const bound = { projectId: "project-a", teamId: "team-a", repositoryIds: ["123"], actions: ["git:write"] }

function runner(pages: unknown[], name = "Developer", email = "dev@example.com") {
  const run = vi.fn(async (binary: string, args: string[]) => {
    if (binary === "git") return args.at(-1) === "user.name" ? name : email
    return JSON.stringify(pages.shift())
  })
  return { run, invoke: run as typeof runSandboxCli }
}

describe("managed sandbox Git startup", () => {
  it("uses existing exact repository authorization and configured identity without exporting host credentials", async () => {
    const { run, invoke } = runner([{ bounds: [bound] }])
    expect(await sandboxGitCredentials(project, invoke, "/preferred/cwd")).toEqual({
      __source_credentials: true,
      __commitAs: { name: "Developer", email: "dev@example.com" },
      resources: { vcpus: 6 }
    })
    expect(run).toHaveBeenCalledWith("git", ["config", "--get", "user.email"], {
      cwd: "/preferred/cwd",
      signal: undefined,
      timeoutMs: 5000
    })
    expect(run.mock.calls.filter(([binary]) => binary === "vercel")).toEqual([
      ["vercel", ["api", "/v1/git-credential-broker/bounds?teamId=team-a", "--scope", "team-a", "--raw"]]
    ])
  })

  it("does not borrow another project, team, repository, action or delegated authorization", async () => {
    for (const change of [
      { projectId: "other" },
      { teamId: "other" },
      { repositoryIds: ["456"] },
      { actions: ["github:pull-request:create"] },
      { actAs: ["42"] }
    ]) {
      const { run, invoke } = runner([{ bounds: [{ ...bound, ...change }] }])
      expect(await sandboxGitCredentials(project, invoke)).toEqual({})
      expect(run).toHaveBeenCalledTimes(1)
    }
  })

  it("follows pagination before choosing public cloning", async () => {
    const { run, invoke } = runner([
      { bounds: [], pagination: { next: "page/2" } },
      { bounds: [bound], pagination: { next: null } }
    ])
    expect((await sandboxGitCredentials(project, invoke)).__source_credentials).toBe(true)
    expect(run.mock.calls[1][1][1]).toContain("cursor=page%2F2")
    const empty = runner([{ bounds: [], pagination: { next: null } }])
    expect(await sandboxGitCredentials(project, empty.invoke)).toEqual({})
  })

  it("fails closed on policy lookup failure, malformed responses, loops and missing identity", async () => {
    const denied = vi.fn(async () => {
      throw new Error("403 denied")
    })
    await expect(sandboxGitCredentials(project, denied)).rejects.toThrow("403 denied")
    await expect(sandboxGitCredentials(project, runner([{}]).invoke)).rejects.toThrow("invalid")
    const loop = runner([
      { bounds: [], pagination: { next: "same" } },
      { bounds: [], pagination: { next: "same" } }
    ])
    await expect(sandboxGitCredentials(project, loop.invoke)).rejects.toThrow("repeated")
    await expect(sandboxGitCredentials(project, runner([{ bounds: [bound] }], "", "").invoke)).rejects.toThrow(
      "user.name and user.email"
    )
  })
})

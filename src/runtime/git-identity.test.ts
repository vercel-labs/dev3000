import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { configuredGitIdentity } from "./git-identity.js"
import { runSandboxCli } from "./sandbox-process.js"

it("carries the configured preference into remote Git without inventing missing identity fields", async () => {
  const directory = mkdtempSync(join(tmpdir(), "d3k-git-identity-"))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
  for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"])
    delete env[key]
  const run: typeof runSandboxCli = (binary, args, options) => runSandboxCli(binary, args, { ...options, env })
  try {
    await run("git", ["init", directory])
    expect(await configuredGitIdentity(run, directory)).toBeUndefined()
    await run("git", ["config", "user.name", "Preferred Author"], { cwd: directory })
    expect(await configuredGitIdentity(run, directory)).toBeUndefined()
    await run("git", ["config", "user.email", "preferred@example.test"], { cwd: directory })
    const identity = await configuredGitIdentity(run, directory)
    expect(identity).toEqual({
      GIT_AUTHOR_NAME: "Preferred Author",
      GIT_AUTHOR_EMAIL: "preferred@example.test",
      GIT_COMMITTER_NAME: "Preferred Author",
      GIT_COMMITTER_EMAIL: "preferred@example.test"
    })
    for (const variable of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"])
      expect(await runSandboxCli("git", ["var", variable], { env: { ...env, ...identity }, cwd: tmpdir() })).toMatch(
        /^Preferred Author <preferred@example\.test> /
      )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

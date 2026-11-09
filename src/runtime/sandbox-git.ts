import { configuredGitIdentity } from "./git-identity.js"
import { runSandboxCli } from "./sandbox-process.js"

interface GitBound {
  projectId: string
  teamId: string
  repositoryIds: string[]
  actions: string[]
  actAs?: string[]
}

/** Discover existing broker authorization on the laptop; never provision or export GitHub secrets. */
export async function sandboxGitCredentials(
  project: { id: string; accountId: string; link?: { repoId: number } },
  run: typeof runSandboxCli = runSandboxCli,
  cwd = process.cwd()
): Promise<{
  __source_credentials?: true
  __commitAs?: { name: string; email: string }
  resources?: { vcpus: number }
}> {
  if (!project.link?.repoId) return {}
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const query = new URLSearchParams({ teamId: project.accountId })
    if (cursor) query.set("cursor", cursor)
    const page = JSON.parse(
      await run("vercel", ["api", `/v1/git-credential-broker/bounds?${query}`, "--scope", project.accountId, "--raw"])
    ) as { bounds: GitBound[]; pagination?: { next?: string | null } }
    if (!Array.isArray(page.bounds)) throw new Error("Vercel returned invalid Git credential Bounds")
    const authorized = page.bounds.some(
      (bound) =>
        bound.projectId === project.id &&
        bound.teamId === project.accountId &&
        bound.repositoryIds.includes(String(project.link?.repoId)) &&
        bound.actions.includes("git:write") &&
        !bound.actAs?.length
    )
    if (authorized) {
      const identity = await configuredGitIdentity(run, cwd)
      if (!identity) throw new Error("Managed Sandbox Git requires your configured git user.name and user.email")
      return {
        // The installed SDK forwards __ parameters. These are the broker's supported legacy fields.
        __source_credentials: true,
        __commitAs: { name: identity.GIT_AUTHOR_NAME, email: identity.GIT_AUTHOR_EMAIL },
        // Managed Git currently requires a cold allocation: 1/2/4/8-vCPU warm images omit its helper.
        // Sandbox enforces the team's effective resource limits; never downgrade to a broken warm image.
        resources: { vcpus: 6 }
      }
    }
    cursor = page.pagination?.next || undefined
    if (cursor && seen.has(cursor)) throw new Error("Vercel repeated the Git credential Bounds cursor")
    if (cursor) seen.add(cursor)
  } while (cursor)
  return {}
}

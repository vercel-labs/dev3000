import { runSandboxCli } from "./sandbox-process.js"

/** Use the user's configured preference; never invent a sandbox identity. */
export async function configuredGitIdentity(
  run: typeof runSandboxCli = runSandboxCli,
  cwd = process.cwd(),
  signal?: AbortSignal
): Promise<Record<string, string> | undefined> {
  const [name, email] = await Promise.all(
    ["user.name", "user.email"].map((key) =>
      run("git", ["config", "--get", key], { cwd, signal, timeoutMs: 5000 })
        .then((value) => value.trim())
        .catch(() => "")
    )
  )
  if (!name || !email) return undefined
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email }
}

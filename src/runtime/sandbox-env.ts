import { runSandboxCli } from "./sandbox-process.js"

/** Preflight access before allocating compute; keep decrypted values in memory. */
export async function sandboxDevelopmentEnv(
  project: { id: string; accountId: string },
  cwd: string,
  run: typeof runSandboxCli = runSandboxCli
): Promise<Record<string, string>> {
  let response: string
  try {
    response = await run(
      "vercel",
      ["api", `/v3/env/pull/${encodeURIComponent(project.id)}/development`, "--scope", project.accountId, "--raw"],
      { cwd }
    )
  } catch (error) {
    if (error instanceof Error && /challenge required/i.test(error.message))
      throw new Error(
        `Vercel requires fresh authentication for this project's Development environment. Run vercel env pull /dev/null --project ${project.id} --scope ${project.accountId} --environment development --yes, complete the browser challenge, then retry d3k. No sandbox has been started.`,
        { cause: error }
      )
    throw error
  }
  const development = JSON.parse(response) as { env?: Record<string, unknown> }
  if (!development.env || typeof development.env !== "object" || Array.isArray(development.env))
    throw new Error("Could not load Development environment")
  const env = Object.fromEntries(
    Object.entries(development.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
  delete env.VERCEL_OIDC_TOKEN
  delete env.VERCEL_TOKEN
  delete env.VERCEL_AUTH_TOKEN
  return env
}

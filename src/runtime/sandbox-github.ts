import { runSandboxCli } from "./sandbox-process.js"

export function workspaceGithubRequest(repository: string, args: Record<string, unknown>) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("No linked GitHub repository")
  const method = String(args.method)
  const path = String(args.path)
  if (
    !["GET", "POST", "PATCH"].includes(method) ||
    !/^\/(git\/(blobs|trees|commits|refs?|matching-refs)|pulls)(\/|\?|$)[\w/?.=&%-]*$/.test(path) ||
    path.includes("..") ||
    path.includes("%") ||
    path.includes("//")
  )
    throw new Error("Use a supported repo-relative Git Data or pulls endpoint")
  if (args.body && (typeof args.body !== "object" || Array.isArray(args.body)))
    throw new Error("body must be an object")
  if ((args.body as { force?: unknown } | undefined)?.force) throw new Error("Force pushes are not supported")
  return {
    args: [
      "api",
      "--hostname",
      "github.com",
      "--method",
      method,
      `repos/${repository}${path}`,
      ...(args.body ? ["--input", "-"] : [])
    ],
    input: args.body ? JSON.stringify(args.body) : undefined
  }
}

/** Run only repository-scoped Git Data/PR operations; the credential stays local. */
export async function callSandboxGithub(
  repository: string,
  args: Record<string, unknown>,
  options: { cwd?: string; signal?: AbortSignal } = {}
) {
  const request = workspaceGithubRequest(repository, args)
  return runSandboxCli("gh", request.args, { ...options, input: request.input, timeoutMs: 60000 })
}

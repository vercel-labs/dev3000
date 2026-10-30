import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Sandbox } from "@vercel/sandbox"
import { getAgentBrowserBinaryPath } from "../utils/agent-browser.js"
import { captureBrowserMetrics } from "./browser-metrics.js"
import { type Harness, runHarnessProcess } from "./harness.js"
import { runSandboxCli } from "./sandbox-process.js"
import { startWorkspaceBroker, workspaceHandler } from "./sandbox-workspace.js"

export function localWorkspaceInstructions(workdir: string, appUrl: string, helper: string): string {
  return `# d3k remote workspace

You are running LOCALLY. The project code, dependencies, environment, Git checkout, and dev server are in a Vercel Sandbox at ${JSON.stringify(workdir)}. This local directory contains only d3k connection files. Do not clone, download, or recreate the project locally. Do not use native local file/edit tools for project files.

Connection details are refreshed on every launch. Use the helper and MCP connection below even when continuing a prior conversation; old broker addresses and credentials are invalid. Do not replay unfinished commands automatically.

The app is already running at ${JSON.stringify(appUrl)} in the user's local Chrome. Use the d3k workspace tools immediately; do not discover a CDP port, install browsers, or start another runtime. Your normal local image-paste capability works here.

After responsive/device testing, use sandbox_browser with args ["set","viewport","0","0","0"] to restore window-sized rendering. Verify the page fills the headed window before handing it back. Do not restore to a guessed desktop size such as 1280x900, which leaves a fixed viewport when the user resizes the window.

Use the d3k MCP tools sandbox_exec, sandbox_read_file, sandbox_write_file, sandbox_runtime, sandbox_browser, and sandbox_github. If MCP tools are not available (including fx), use the following exact helper commands with your native shell tool. The helper forwards requests to the same remote workspace; it does not execute project commands locally:

\`\`\`sh
${helper} sandbox_exec '{"command":"pwd; git status --short; test ! -f AGENTS.md || cat AGENTS.md"}'
${helper} sandbox_read_file '{"path":"package.json"}'
${helper} sandbox_write_file '{"path":"example.txt","content":"new file content"}'
${helper} sandbox_runtime '{"args":["status"]}'
${helper} sandbox_recover '{"action":"start"}'
${helper} sandbox_recover '{"action":"status"}'
${helper} sandbox_browser '{"args":["snapshot","-i"]}'
${helper} sandbox_browser '{"args":["click","@e2"]}'
${helper} sandbox_browser '{"args":["metrics","https://example.com/","--new-tab"]}'
${helper} sandbox_runtime '{"args":["events","--limit","50"]}'
${helper} sandbox_github '{"method":"GET","path":"/git/ref/heads/main"}'
\`\`\`

For loading metrics, prefer sandbox_browser args ["metrics","https://example.com/","--new-tab"] over custom eval scripts. It installs observers before navigation and returns Web Vitals, navigation timing, long tasks and resource summaries as JSON. Omit the URL for a current-page snapshot without reload; CLS and long tasks are then unavailable. Results use the existing cache and throttling; null means unavailable and paint/vitals values are provisional.

For file contents, patches, or GitHub upload bodies, pipe JSON to the helper with a final \`-\` argument instead of putting large JSON in command-line arguments: \`producer | ${helper} sandbox_github -\`. Keep project contents in tool input/output memory rather than local files. sandbox_github accepts method (GET, POST, PATCH), repo-relative path, and optional body (JSON object). For example, POST /git/blobs takes body {"content":"BASE64","encoding":"base64"}; POST /pulls takes body {"title":"...","head":"feature-branch","base":"main","body":"...","draft":true}. Check isError in helper responses and exitCode in remote command results before continuing.

If sandbox_runtime reports running:false or the app returns 502 after the dev runtime stops, call sandbox_recover with action start, then poll action status until recovered or failed. Recovery preserves this agent, remote edits and local Chrome; it does not clone, reinstall or replay your commands. Reread runtime status and reproduce after recovery because old in-memory evidence is lost. If recovery fails, report the error and preserve edits.

Read the remote project's AGENTS.md and any narrower instructions before editing. Use remote shell searches and patch commands for focused edits; sandbox_write_file writes the entire file. Run tests, Git branches, and commits remotely. For publishing, use sandbox_github with repo-relative Git Data API paths to upload the remote commit's blobs, trees, commits, and branch ref, then create /pulls. It authenticates locally against only this project's linked repository; do not copy GitHub credentials into the sandbox. Preserve remote commit author, committer, timestamps and parents when publishing; confirm returned commit SHA matches. Existing remote Git authentication can also be used for git push. Use sandbox_runtime status before a reproduction, then events --session ID --after CURSOR afterward; reset or dropped events mean an evidence gap. Use the existing browser autonomously for UI checks. Batch related remote commands to reduce network round trips. Shell calls have a 60-second deadline; a timeout does not prove the command stopped, so inspect remote state before retrying mutations. Report disconnected tools instead of falling back to a local checkout. Await the user's task before modifying project code.`
}

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

export function prepareLocalSandboxHarness(
  harness: Harness,
  directory: string,
  connection: { url: string; token: string },
  workdir: string,
  appUrl: string,
  resume = false
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const configPath = join(directory, "connection.json")
  writeFileSync(configPath, JSON.stringify(connection), { mode: 0o600 })
  const client = fileURLToPath(new URL("./workspace-client.js", import.meta.url))
  const node = process.execPath
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const helper = [node, client, configPath].map(quote).join(" ")
  const instructions = localWorkspaceInstructions(workdir, appUrl, helper)
  writeFileSync(join(directory, "AGENTS.md"), instructions, { mode: 0o600 })
  writeFileSync(join(directory, "CLAUDE.md"), instructions, { mode: 0o600 })
  const mcp = { command: node, args: [client, configPath, "--stdio"] }
  const mcpPath = join(directory, ".mcp.json")
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { d3k: mcp } }), { mode: 0o600 })
  const args =
    harness === "codex"
      ? [
          "-c",
          `mcp_servers.d3k.command=${JSON.stringify(mcp.command)}`,
          "-c",
          `mcp_servers.d3k.args=${JSON.stringify(mcp.args)}`,
          instructions
        ]
      : harness === "claude"
        ? ["--mcp-config", mcpPath, "--append-system-prompt", instructions]
        : resume
          ? ["-c"]
          : []
  return { binary: harness, args }
}

export interface LocalSandboxWorkspaceOptions {
  directory: string
  sandbox: Sandbox
  workdir: string
  appUrl: string
  signal: AbortSignal
  chromePort: number
  sessionId: string
  repository?: string
  recover?: (args: Record<string, unknown>) => Promise<import("./sandbox-workspace.js").WorkspaceResult>
}

/** Shared by terminal harnesses and desktop MCP; credentials stay in this process. */
export async function createLocalSandboxWorkspace(options: LocalSandboxWorkspaceOptions) {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 })
  const [name, email] = await Promise.all(
    ["user.name", "user.email"].map((key) =>
      runSandboxCli("git", ["config", "--get", key], {
        cwd: options.directory,
        timeoutMs: 5000,
        signal: options.signal
      })
        .then((value) => value.trim())
        .catch(() => "")
    )
  )
  const gitIdentity =
    name && email
      ? { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email }
      : undefined
  const remote = workspaceHandler(options.sandbox, options.workdir, gitIdentity)
  return async (name: string, args: Record<string, unknown>) => {
    if (name === "sandbox_recover") {
      if (!options.recover) throw new Error("Recovery is unavailable in this older companion; exit and resume it")
      return options.recover(args)
    }
    let output: string
    if (name === "sandbox_github") {
      const request = workspaceGithubRequest(options.repository || "", args)
      output = await runSandboxCli("gh", request.args, {
        input: request.input,
        cwd: options.directory,
        timeoutMs: 60000,
        signal: options.signal
      })
    } else if (name === "sandbox_browser") {
      if (
        !Array.isArray(args.args) ||
        args.args.some(
          (arg) =>
            typeof arg !== "string" ||
            /^(--(cdp|profile|profile-dir|session|session-name|auto-connect|provider|engine|executable-path|config)|connect|close)(=|$)/.test(
              arg
            )
        )
      )
        throw new Error("Use browser interaction arguments; the connection is managed by d3k")
      if (args.args[0] === "metrics") {
        const metrics = await captureBrowserMetrics(args.args.slice(1) as string[], (command) =>
          runSandboxCli(
            getAgentBrowserBinaryPath(),
            ["--session", `d3k-local-${options.sessionId}`, "--cdp", String(options.chromePort), ...command],
            { cwd: options.directory, timeoutMs: 30000, signal: options.signal }
          )
        )
        return { content: [{ type: "text" as const, text: JSON.stringify(metrics) }] }
      }
      output = await runSandboxCli(
        getAgentBrowserBinaryPath(),
        ["--session", `d3k-local-${options.sessionId}`, "--cdp", String(options.chromePort), ...args.args],
        { cwd: options.directory, timeoutMs: 60000, signal: options.signal }
      )
    } else return remote(name, args)
    return { content: [{ type: "text" as const, text: output }] }
  }
}

export async function launchLocalSandboxHarness(
  options: LocalSandboxWorkspaceOptions & { harness: Harness; gateway?: { key: string }; resume?: boolean }
) {
  const broker = await startWorkspaceBroker(await createLocalSandboxWorkspace(options))
  try {
    const invocation = prepareLocalSandboxHarness(
      options.harness,
      options.directory,
      broker,
      options.workdir,
      options.appUrl,
      options.resume
    )
    await runHarnessProcess(invocation.binary, invocation.args, {
      cwd: options.directory,
      signal: options.signal,
      env:
        options.gateway && options.harness === "fx"
          ? { ...process.env, FX_PROVIDER: "gateway", AI_GATEWAY_API_KEY: options.gateway.key }
          : undefined
    })
  } finally {
    try {
      await broker.close()
    } finally {
      clearLocalHarnessConnection(options.directory)
    }
  }
}

/** A stable fx workspace must never retain a live broker credential between launches. */
export function clearLocalHarnessConnection(directory: string): void {
  for (const file of ["connection.json", ".mcp.json"]) rmSync(join(directory, file), { force: true })
}

import { fileURLToPath } from "node:url"
import { getPortlessProxyStatus } from "../portless.js"
import { serveMcp } from "./mcp-stdio.js"
import { launchSandbox, type SandboxOptions } from "./sandbox.js"
import { resolveSandboxResume } from "./sandbox-command.js"
import { listSandboxSessions, type SandboxSession, sandboxLauncherAlive } from "./sandbox-sessions.js"
import { type WorkspaceResult, workspaceTools } from "./sandbox-workspace.js"

export const desktopInstructions = `d3k connects this desktop assistant to a REMOTE Vercel Sandbox and an existing LOCAL Chrome. Call sandbox_sessions first; use sandbox_start with project or a saved resume ID, then poll sandbox_status until phase=ready. Startup takes time; never treat starting as ready or start a second session. If Portless or Vercel login needs setup, report the exact prerequisite to the user.
An explicitly requested remote sandbox takes precedence over this chat's linked local repository. Start with project and the requested branch for a fresh remote checkout; use resume or attach only when the user requests reuse. A failed fresh start is not permission to attach to an unrelated old checkout or drop the requested branch. Report the actual startup error without guessing that the repository is private.
Project files, app environment, installs, tests and Git edits stay REMOTE. Never clone or recreate the project locally. Use sandbox_exec, sandbox_read_file and sandbox_write_file for project work. Read the remote AGENTS.md and narrower instructions before editing. sandbox_exec runs in the remote project root and has a 60-second deadline; inspect remote state before retrying a timed-out mutation.
Use sandbox_browser immediately for the already connected LOCAL Chrome, e.g. args=["snapshot","-i"]. CDP is managed: do not hunt for ports, install browsers, or start another runtime/browser. Use sandbox_runtime args=["status"] before reproducing; retain sessionId/cursor, then read events --session ID --after CURSOR. Continue while hasMore; reset or dropped means an evidence gap.
For loading metrics, use sandbox_browser args=["metrics","https://example.com/","--new-tab"]. This installs observers before navigation and returns Web Vitals, navigation timing, long tasks and resource summaries as JSON. Prefer it over custom eval scripts. Omit the URL for a current-page snapshot without reload; CLS and long tasks are then unavailable. Results use existing cache/throttling and provisional vitals; null means unavailable.
After responsive/device testing, restore window-sized rendering with sandbox_browser args=["set","viewport","0","0","0"]. Verify the page fills the headed window before handing it back. Do not restore to a guessed desktop size such as 1280x900; that leaves a fixed viewport when the user resizes the window.
When the user is on a phone or asks for a phone preview, start with browser="link" and present the ready status preview.url as a clickable link. This runs companion Chrome headlessly for agent testing; it does not control the phone's browser. Never give a phone the .localhost URL. Treat preview.url as a bearer credential: share only in this user's chat, never in a PR or public logs. It expires with the session and is regenerated on resume. Local stdio supplies no phone User-Agent, so select link mode only from explicit client/user context; do not guess from a mobile viewport. The laptop companion and a client that can reach its MCP tools are still required; this does not enable phone-only ChatGPT connectivity.
Use sandbox_github for linked-repository Git Data and pull-request APIs using local gh authentication. Run Git branches and commits remotely; preserve author/committer/parents when uploading Git objects and verify matching SHAs. Do not send local GitHub/Vercel credentials into the VM. Make commits or PRs when requested by the user.
If the dev runtime stops or returns 502, use sandbox_recover action=start, then poll action=status until recovered or failed. This preserves the current agent, browser and edits without cloning or installing. Reread sandbox_runtime status and reproduce after recovery; old in-memory evidence is lost.
Keep the session alive while the user tests. sandbox_stop closes Chrome and stops d3k-owned compute while preserving remote files and a resume ID; externally attached sandboxes remain running. Disconnecting this MCP server also closes its session. No Gateway key or terminal harness is started; this desktop client provides the model. One active sandbox per MCP server. Tool results and desktop conversation history may contain source read remotely. Await the user's task before modifying code.`

const emptySchema = { type: "object", properties: {}, additionalProperties: false }
export const desktopTools = [
  {
    name: "sandbox_sessions",
    description: "List saved resumable d3k sandbox sessions and this desktop connection's current session.",
    inputSchema: emptySchema
  },
  {
    name: "sandbox_start",
    description:
      "Start a remote project or resume a saved session with local Chrome, without a terminal harness or Gateway key. Returns starting immediately; poll sandbox_status for readiness. One session per server. Requires local Vercel login, macOS and canonical Portless setup.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Vercel team/project or project ID. Omit when resuming." },
        resume: { type: "string", description: "Saved session ID from sandbox_sessions. Omit project." },
        scope: { type: "string" },
        branch: { type: "string" },
        attach: { type: "string", description: "Existing sandbox containing the remote checkout." },
        name: { type: "string" },
        hostname: { type: "string" },
        region: { type: "string" },
        timeout: {
          type: "integer",
          minimum: 1,
          maximum: 1440,
          description: "Compute lifetime in minutes; default 60."
        },
        command: { type: "string", description: "Remote dev command override." },
        installCommand: { type: "string", description: "Remote dependency install command override." },
        headless: { type: "boolean" },
        browser: {
          type: "string",
          enum: ["local", "link"],
          description:
            "Use link for phone testing: return a protected HTTPS preview and run companion Chrome headlessly. The laptop companion is still required. Defaults to local."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "sandbox_status",
    description:
      "Read desktop connection readiness and bounded startup progress. Wait for phase=ready before workspace tools; failed includes the error. For browser/server evidence use sandbox_runtime after readiness.",
    inputSchema: emptySchema
  },
  {
    name: "sandbox_stop",
    description:
      "Close this desktop connection's browser and runtime, preserving remote code and resume metadata. Returns stopping; poll sandbox_status until stopped before starting/resuming another session. Does not delete the sandbox.",
    inputSchema: emptySchema
  },
  ...workspaceTools
] as const

export function desktopMcpConfig() {
  return {
    mcpServers: {
      d3k: {
        command: process.execPath,
        args: [fileURLToPath(new URL("./cli.js", import.meta.url)), "mcp"],
        // GUI applications commonly start with a minimal PATH. No credentials in config.
        env: { PATH: process.env.PATH || "" }
      }
    }
  }
}

function startOptions(args: Record<string, unknown>): SandboxOptions {
  const allowed = new Set([
    "project",
    "resume",
    "scope",
    "branch",
    "attach",
    "name",
    "hostname",
    "region",
    "timeout",
    "command",
    "installCommand",
    "headless",
    "browser"
  ])
  for (const [key, value] of Object.entries(args)) {
    if (!allowed.has(key)) throw new Error(`Unknown sandbox_start option: ${key}`)
    if (key === "browser") {
      if (value !== "local" && value !== "link") throw new Error("browser must be local or link")
    } else if (key === "headless") {
      if (typeof value !== "boolean") throw new Error("headless must be a boolean")
    } else if (key === "timeout") {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1440)
        throw new Error("timeout must be 1–1440 minutes")
    } else if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a nonempty string`)
  }
  if (args.browser === "link" && args.headless === false) throw new Error("Link mode requires headless Chrome")
  const { browser, ...launchArgs } = args
  const options = resolveSandboxResume({
    ...launchArgs,
    ...(browser === "link" ? { preview: true, headless: true } : {}),
    ...(args.timeout === undefined ? {} : { timeout: String(args.timeout) }),
    // Overrides saved terminal preferences on resume; desktop supplies its own model.
    shell: false,
    fx: false,
    gateway: false,
    harness: undefined,
    harnessLocation: undefined
  } as Partial<SandboxOptions>)
  if (!options) throw new Error("Specify project or a saved resume ID")
  return options
}

export function createDesktopWorkspace(
  dependencies = {
    launch: launchSandbox,
    list: listSandboxSessions,
    portless: getPortlessProxyStatus
  }
) {
  let phase: "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed" = "idle"
  let session: SandboxSession | undefined
  let preview: { url: string; expiresAt: string } | undefined
  let error: string | undefined
  let progress: string[] = []
  let call: ((name: string, args: Record<string, unknown>) => Promise<WorkspaceResult>) | undefined
  let controller: AbortController | undefined
  let running: Promise<void> | undefined
  const status = () => ({
    phase,
    session,
    ...(phase === "ready" && preview ? { preview } : {}),
    error,
    progress: [...progress]
  })
  const result = (value: unknown): WorkspaceResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] })
  return {
    async call(name: string, args: Record<string, unknown>): Promise<WorkspaceResult> {
      if (name === "sandbox_sessions")
        return result({
          ...status(),
          sessions: dependencies.list().map((item) => ({ ...item, companionRunning: sandboxLauncherAlive(item) }))
        })
      if (name === "sandbox_status") return result(status())
      if (name === "sandbox_stop") {
        if (running) {
          phase = "stopping"
          call = undefined
          controller?.abort()
        }
        return result(status())
      }
      if (name === "sandbox_start") {
        if (running)
          throw new Error("This desktop connection already owns a session; stop it and wait for stopped first")
        const options = startOptions(args)
        const portless = dependencies.portless()
        if (!portless.canonical || !portless.serviceInstalled || portless.setupRequired)
          throw new Error(
            "Canonical Portless is required. Run d3k portless setup in a terminal, authorize it, then retry."
          )
        controller = new AbortController()
        const signal = controller.signal
        phase = "starting"
        session = undefined
        preview = undefined
        error = undefined
        progress = []
        running = Promise.resolve()
          .then(() =>
            dependencies.launch(options, {
              signal,
              log: (message) => {
                progress = [...progress, message.slice(-2000)].slice(-20)
              },
              onClosing: () => {
                phase = "stopping"
                call = undefined
              },
              onReady: (workspace) => {
                if (signal.aborted) return
                session = { ...workspace.session }
                preview = workspace.preview
                call = workspace.call
                phase = "ready"
              }
            })
          )
          .then(
            () => {
              phase = "stopped"
            },
            (failure: unknown) => {
              error = signal.aborted ? undefined : failure instanceof Error ? failure.message : "Sandbox startup failed"
              phase = error ? "failed" : "stopped"
            }
          )
          .finally(() => {
            call = undefined
            running = undefined
          })
        return result(status())
      }
      if (!workspaceTools.some((tool) => tool.name === name)) throw new Error("Unknown workspace tool")
      if (phase !== "ready" || !call)
        throw new Error("No ready sandbox. Use sandbox_start and poll sandbox_status first.")
      return call(name, args)
    },
    async close() {
      call = undefined
      if (running) {
        phase = "stopping"
        controller?.abort()
        await running
      }
    }
  }
}

export async function runDesktopMcp() {
  const workspace = createDesktopWorkspace()
  let stopping = false
  const stop = () => {
    stopping = true
    void workspace.close()
    process.stdin.destroy()
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  // EOF means the desktop client disconnected. Begin cleanup before waiting on tool calls.
  process.stdin.once("end", stop)
  try {
    await serveMcp({ name: "d3k", instructions: desktopInstructions, tools: desktopTools, call: workspace.call })
  } catch (error) {
    if (!stopping) throw error
  } finally {
    await workspace.close()
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
    process.stdin.off("end", stop)
  }
}

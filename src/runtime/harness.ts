import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { InvalidArgumentError } from "commander"
import { terminalRestorer } from "./terminal.js"

export const HARNESS_NAMES = ["fx", "codex", "claude"] as const
export type Harness = (typeof HARNESS_NAMES)[number]
export const HARNESS_LOCATIONS = ["local", "sandbox"] as const
export type HarnessLocation = (typeof HARNESS_LOCATIONS)[number]
export function parseHarnessLocation(value: string): HarnessLocation {
  if (!(HARNESS_LOCATIONS as readonly string[]).includes(value))
    throw new InvalidArgumentError("Choose a harness location: local, sandbox")
  return value as HarnessLocation
}
export function parseHarness(value: string): Harness {
  if (!(HARNESS_NAMES as readonly string[]).includes(value))
    throw new InvalidArgumentError(`Choose a harness: ${HARNESS_NAMES.join(", ")}`)
  return value as Harness
}
export const bundledSkillPath = fileURLToPath(new URL("../../skills/d3k/SKILL.md", import.meta.url))
export interface SandboxHarnessContext {
  workdir: string
  appUrl: string
}
export function harnessInstructions(sandbox?: SandboxHarnessContext): string {
  const runtime = sandbox ? "/tmp/d3k-tools/node_modules/.bin/d3k-runtime" : "d3k"
  return `The d3k runtime and its monitored browser are already running. You can control that browser now.
${sandbox ? `You are running inside a Vercel Sandbox. Execute the following commands HERE in the sandbox, from ${JSON.stringify(sandbox.workdir)}. The browser runs on the user's laptop and displays ${JSON.stringify(sandbox.appUrl)}. Its CDP connection is already bridged to this sandbox.` : "Execute the following commands from the project root."}

Use \`${runtime}\` as \`runtime\` in the d3k skill. For browser testing, use these commands directly:

\`\`\`sh
${runtime} status
${runtime} browser snapshot -i
${runtime} browser click @e2
${runtime} browser metrics https://example.com/ --new-tab
${runtime} events --limit 50
\`\`\`

The browser subcommand runs the bundled agent-browser and supplies the existing CDP connection automatically. Element refs come from the latest snapshot. You do not need a CDP port, a new browser, a browser install, or another agent-browser server. Do not run bare agent-browser without the managed connection. Use the existing browser for UI testing and reproductions; do not ask the user to run browser commands for you. If disconnected, inspect status and report the connection problem instead of opening another browser. Do not start another runtime.${sandbox ? " Do not run Portless setup inside the sandbox; the laptop companion already handles it." : ""}

For loading metrics, prefer browser metrics URL --new-tab over custom eval scripts. It installs observers before navigation and returns Web Vitals, navigation timing, long tasks and resource summaries as JSON. Omit the URL for a current-page snapshot without reload; CLS and long tasks are then unavailable. Results use the existing cache and throttling; null means unavailable and paint/vitals values are provisional.

After responsive/device testing, run \`${runtime} browser set viewport 0 0 0\` to restore window-sized rendering. Verify the page fills the headed window before handing it back; do not leave a guessed desktop size such as 1280x900 that stays fixed when the user resizes the window.
Await the user's instructions before modifying code.`
}
export function harnessSkill(sandbox?: SandboxHarnessContext): string {
  const source = readFileSync(bundledSkillPath, "utf8")
  // Only the connected-session workflow belongs in startup context. Provisioning
  // and launcher instructions would invite the harness to start another session.
  const workflow = source.slice(source.indexOf("## Reproduce and inspect"), source.indexOf("## Vercel Sandbox"))
  const runtime = sandbox ? "/tmp/d3k-tools/node_modules/.bin/d3k-runtime" : "d3k"
  return `${source.slice(0, source.indexOf("# d3k"))}# d3k\n\n## Connected session\n\n${harnessInstructions(sandbox)}\n\n${workflow.replace(/`runtime\b/g, `\`${runtime}`)}`
}
export function harnessStartupContext(sandbox?: SandboxHarnessContext): string {
  return harnessSkill(sandbox).replace(/^---\n[\s\S]*?\n---\n+/, "")
}
export function harnessInvocation(
  harness: Harness,
  skillPath: string,
  contextDirectory: string,
  sandbox?: SandboxHarnessContext,
  resume = false
) {
  parseHarness(harness)
  const prompt = `The d3k connected-session skill is loaded below (also available at ${JSON.stringify(skillPath)}).\n\n${harnessStartupContext(sandbox)}`
  return {
    binary: harness,
    args: harness === "fx" ? [...(resume ? ["-c"] : []), "--add-dir", contextDirectory] : [prompt]
  }
}

/** Only fixed binaries and argument arrays; the selection never passes through a shell. */
export async function launchLocalHarness(harness: Harness, cwd: string, signal: AbortSignal): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("--harness requires an interactive terminal")
  const directory = mkdtempSync(join(tmpdir(), "d3k-harness-"))
  const skillDirectory = join(directory, ".fx", "skills", "d3k")
  mkdirSync(skillDirectory, { recursive: true })
  const skillPath = join(skillDirectory, "SKILL.md")
  writeFileSync(skillPath, harnessSkill(), { mode: 0o600 })
  const invocation = harnessInvocation(harness, skillPath, directory)
  try {
    await runHarnessProcess(invocation.binary, invocation.args, { cwd, signal })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export async function runHarnessProcess(
  binary: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal; env?: NodeJS.ProcessEnv }
): Promise<void> {
  if (options.signal.aborted) return
  const restoreTerminal = terminalRestorer()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd, env: options.env, stdio: "inherit", shell: false })
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = () => {
      child.kill("SIGTERM")
      timer = setTimeout(() => child.kill("SIGKILL"), 1000)
      timer.unref()
    }
    options.signal.addEventListener("abort", abort, { once: true })
    const cleanup = () => {
      options.signal.removeEventListener("abort", abort)
      clearTimeout(timer)
      restoreTerminal()
    }
    child.on("error", (error) => {
      cleanup()
      reject(new Error(`Could not launch ${binary}: ${error.message}. Install and authenticate the harness first.`))
    })
    child.on("exit", (code) => {
      cleanup()
      if (options.signal.aborted || code === 0) resolve()
      else reject(new Error(`${binary} exited with code ${code}`))
    })
  })
}

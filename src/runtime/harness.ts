import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { InvalidArgumentError } from "commander"

export const HARNESS_NAMES = ["fx", "codex", "claude"] as const
export type Harness = (typeof HARNESS_NAMES)[number]
export function parseHarness(value: string): Harness {
  if (!(HARNESS_NAMES as readonly string[]).includes(value))
    throw new InvalidArgumentError(`Choose a harness: ${HARNESS_NAMES.join(", ")}`)
  return value as Harness
}
export const bundledSkillPath = fileURLToPath(new URL("../../skills/d3k/SKILL.md", import.meta.url))
export function harnessSkill(): string {
  return `${readFileSync(bundledSkillPath, "utf8").replace(/Use `node <skill-directory>.*?## Prepare/s, "Use `d3k` as `runtime` below, from the project root. The runtime is already running; reuse it.\n\n## Prepare")}\n\n## Harness startup\n\nThe d3k runtime is already running in this workspace. Read its status and use its monitored browser and timeline; do not start another runtime. Await the user's instructions before modifying code. Use d3k status, d3k browser, and d3k events from the project directory.\n`
}
export function harnessInvocation(harness: Harness, skillPath: string, contextDirectory: string) {
  parseHarness(harness)
  const prompt = `Load the d3k skill by reading ${skillPath}. The d3k runtime is already running in this workspace. Use its existing browser and timeline; do not start another runtime. Await further instruction.`
  return { binary: harness, args: harness === "fx" ? ["--add-dir", contextDirectory] : [prompt] }
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
  options: { cwd: string; signal: AbortSignal }
): Promise<void> {
  if (options.signal.aborted) return
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd, stdio: "inherit", shell: false })
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

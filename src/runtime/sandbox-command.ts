import type { Command } from "commander"
import { parseHarness } from "./harness.js"
import type { SandboxOptions } from "./sandbox.js"
import {
  formatSandboxSessions,
  listSandboxSessions,
  readSandboxSession,
  sandboxLauncherAlive
} from "./sandbox-sessions.js"

/** Options shared by the explicit subcommand and the checkout-free root shorthand. */
export function addSandboxProjectOptions(command: Command): Command {
  return command
    .option("--project <team/project-or-id>", "Run a Vercel project in a sandbox, then enter its shell")
    .option("--scope <team>", "Vercel team name or ID")
    .option("--branch <ref>", "Git branch or revision to clone")
    .option("--name <name>", "Name for a new persistent sandbox")
    .option("--harness <name>", "Run fx, codex, or claude in the sandbox terminal", parseHarness)
    .option("--resume [id]", "Resume a saved sandbox session; omit the ID to list sessions")
    .option("--attach <name>", "Use an existing sandbox with its repository already provisioned")
    .option("--hostname <name>", "Stable local app name, e.g. songbook for songbook.d3k.localhost")
    .option("--region <region>", "Vercel Sandbox region")
    .option("--timeout <minutes>", "Compute timeout for the sandbox", "30")
    .option(
      "--install-command <command>",
      "Remote dependency install command (otherwise project setting or bun install)"
    )
    .option("--no-shell", "Keep the companion running without opening an interactive remote shell")
    .option("--no-fx", "Skip fx installation")
}

export function resolveSandboxOptions(options: SandboxOptions): SandboxOptions {
  if (options.harness) parseHarness(options.harness)
  if (options.harness && options.shell === false) throw new Error("--harness cannot be combined with --no-shell")
  if (!options.project) throw new Error("Specify --project <team/project-or-id>")
  if (options.hostname && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(options.hostname))
    throw new Error("--hostname must be a lowercase DNS label, at most 63 characters")
  const parts = options.project.split("/")
  if (parts.length > 2 || parts.some((part) => !part.trim()))
    throw new Error("--project must be a project name/ID or team/project")
  if (parts.length === 2 && options.scope && options.scope !== parts[0])
    throw new Error("The team in --project conflicts with --scope; use one team selector")
  const minutes = Number(options.timeout ?? 30)
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)
    throw new Error("Sandbox timeout must be 1–1440 minutes")
  if (options.attach && (options.branch || options.name))
    throw new Error("--attach uses the existing checkout; omit --branch and --name")
  return { ...options, project: parts[parts.length - 1], scope: parts.length === 2 ? parts[0] : options.scope }
}

export function resolveSandboxResume(options: Partial<SandboxOptions>): SandboxOptions | undefined {
  if (options.resume === true) {
    const records = listSandboxSessions().filter((record) => {
      const project = options.project?.split("/").at(-1)
      const scope = options.scope || (options.project?.includes("/") ? options.project.split("/")[0] : undefined)
      return (
        (!project || project === record.project || project === record.projectName) &&
        (!scope || scope === record.scope || scope === record.team)
      )
    })
    console.log(formatSandboxSessions(records))
    return undefined
  }
  if (typeof options.resume !== "string") return resolveSandboxOptions(options as SandboxOptions)
  for (const option of ["project", "scope", "attach", "branch", "name", "region"] as const)
    if (options[option] !== undefined) throw new Error(`--resume <id> restores ${option}; omit --${option}`)
  const record = readSandboxSession(options.resume)
  if (sandboxLauncherAlive(record))
    throw new Error("This sandbox session still has a running companion; stop it before resuming")
  return resolveSandboxOptions({
    project: record.project,
    scope: record.team,
    attach: record.sandbox,
    hostname: record.hostname,
    command: record.command,
    installCommand: record.installCommand,
    timeout: record.timeout,
    fx: record.fx,
    harness: record.harness,
    ...options
  } as SandboxOptions)
}

export async function runSandboxProject(options: SandboxOptions, command?: Command): Promise<void> {
  // Commander supplies defaults for negated flags; resume should retain saved preferences
  // unless the user explicitly overrides them for this invocation.
  const explicit = { ...options }
  if (options.resume && command)
    for (const key of ["fx", "shell", "timeout"] as const)
      if (command.getOptionValueSource(key) === "default") delete explicit[key]
  const resolved = resolveSandboxResume(explicit)
  if (!resolved) return
  if (resolved.harness && resolved.shell === false) throw new Error("--harness cannot be combined with --no-shell")
  if (resolved.harness && !process.stdin.isTTY) throw new Error("--harness requires an interactive terminal")
  const { launchSandbox } = await import("./sandbox.js")
  await launchSandbox(resolved)
}

export function registerSandboxCommand(program: Command): void {
  // Shared root options must not consume a subcommand's project/team flags.
  program.enablePositionalOptions()
  addSandboxProjectOptions(
    program
      .command("sandbox")
      .description("Run a Vercel project remotely with a dedicated local Chrome (no local checkout)")
  )
    .option("--command <command>", "Remote dev command (otherwise project setting or dev script)")
    .option("--headless", "Run the dedicated local Chrome headlessly")
    .action(runSandboxProject)
}

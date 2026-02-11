#!/usr/bin/env bun

// Intercept agent-browser command early, before Commander parses args
// This allows passing all args directly to agent-browser without Commander interference
const agentBrowserIndex = process.argv.indexOf("agent-browser")
if (agentBrowserIndex >= 0 && (process.argv[1]?.includes("d3k") || process.argv[1]?.includes("dev3000"))) {
  // Use require for synchronous execution before other imports
  const { spawnSync } = require("child_process")
  const { existsSync } = require("fs")
  const { join } = require("path")

  const args = process.argv.slice(agentBrowserIndex + 1)

  // Intercept "errors" and "console" subcommands - redirect to d3k's superior commands
  // These d3k commands show BOTH browser AND server logs, unlike agent-browser which only shows browser
  const subcommandIndex = args.findIndex(
    (arg: string) => !arg.startsWith("-") && !arg.startsWith("@") && arg !== "9222"
  )
  const subcommand = subcommandIndex >= 0 ? args[subcommandIndex] : null

  if (subcommand === "errors") {
    console.log("\x1b[33m💡 Tip: Using `d3k errors` instead (shows browser + server errors)\x1b[0m\n")
    const d3kBin = process.argv[1]
    const result = spawnSync(d3kBin, ["errors"], { stdio: "inherit", shell: false })
    process.exit(result.status ?? 0)
  }

  if (subcommand === "console") {
    console.log("\x1b[33m💡 Tip: Using `d3k logs` instead (shows browser + server logs)\x1b[0m\n")
    const d3kBin = process.argv[1]
    const result = spawnSync(d3kBin, ["logs", "--type", "browser"], { stdio: "inherit", shell: false })
    process.exit(result.status ?? 0)
  }

  // Find agent-browser native binary directly (avoids shell wrapper that needs node)
  function findAgentBrowser(): string {
    const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux"
    const arch = process.arch === "arm64" ? "arm64" : "x64"
    const nativeName = `agent-browser-${os}-${arch}`
    const platformPkg = `${os}-${arch}`

    const cwd = process.cwd()
    const home = require("os").homedir()

    // Prefer native binary to avoid shell wrapper needing node in PATH
    const searchPaths = [
      // Bun global install paths (native binary) - use homedir since compiled binary has virtual path
      join(home, ".bun", "install", "global", "node_modules", "@d3k", platformPkg, "node_modules", ".bin", nativeName),
      join(home, ".bun", "install", "global", "node_modules", "agent-browser", "bin", nativeName),
      // Bun global dev3000 dependency path
      join(home, ".bun", "install", "global", "node_modules", "dev3000", "node_modules", ".bin", nativeName),
      // Local development paths (native binary)
      join(cwd, "node_modules", ".bin", nativeName),
      join(cwd, "node_modules", "agent-browser", "bin", nativeName),
      // Fallback to wrapper script (needs node in PATH)
      join(
        home,
        ".bun",
        "install",
        "global",
        "node_modules",
        "@d3k",
        platformPkg,
        "node_modules",
        ".bin",
        "agent-browser"
      ),
      join(home, ".bun", "install", "global", "node_modules", "dev3000", "node_modules", ".bin", "agent-browser"),
      join(home, ".bun", "install", "global", "node_modules", ".bin", "agent-browser"),
      join(home, ".bun", "install", "global", "node_modules", "agent-browser", "bin", "agent-browser"),
      join(cwd, "node_modules", ".bin", "agent-browser"),
      join(cwd, "node_modules", "agent-browser", "bin", "agent-browser")
    ]

    // npm/pnpm/yarn global install locations (best-effort)
    const globalNodeModules = [
      join("/usr", "local", "lib", "node_modules"),
      join("/opt", "homebrew", "lib", "node_modules")
    ]
    for (const root of globalNodeModules) {
      searchPaths.push(join(root, "dev3000", "node_modules", ".bin", nativeName))
      searchPaths.push(join(root, "dev3000", "node_modules", ".bin", "agent-browser"))
      searchPaths.push(join(root, "agent-browser", "bin", nativeName))
      searchPaths.push(join(root, "agent-browser", "bin", "agent-browser"))
    }

    for (const p of searchPaths) {
      if (existsSync(p)) return p
    }
    return "agent-browser" // fallback to PATH
  }

  const binaryPath = findAgentBrowser()

  // Ensure PATH is set for child process (Claude Code can have empty PATH)
  const env = { ...process.env }
  if (!env.PATH || env.PATH === "") {
    env.PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  }

  // Capture output so we can show errors if command fails
  const result = spawnSync(binaryPath, args, {
    stdio: "pipe",
    shell: false,
    env
  })

  // Show output
  if (result.stdout?.length > 0) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr?.length > 0) {
    process.stderr.write(result.stderr)
  }

  // If spawn failed (e.g., binary not found), show the error
  if (result.error) {
    console.error(`\nError spawning agent-browser: ${result.error.message}`)
    console.error(`Binary path: ${binaryPath}`)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

import chalk from "chalk"
import { Command } from "commander"
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { homedir, tmpdir } from "os"
import { detect } from "package-manager-detector"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { cloudCheckPR } from "./commands/cloud-check-pr.js"
import { cloudFix } from "./commands/cloud-fix.js"
import { createPersistentLogFile, findAvailablePort, startDevEnvironment } from "./dev-environment.js"
import { getBundledSkillsPath, getSkill, getSkillsInfo, listAvailableSkills } from "./skills/index.js"
import { detectAIAgent } from "./utils/agent-detection.js"
import { getAvailableAgents, getSkillsAgentId } from "./utils/agent-selection.js"
import { ensureD3kHomeDir } from "./utils/d3k-dir.js"
import { getProjectDir } from "./utils/project-name.js"
import {
  checkForSkillUpdates,
  getApplicablePackages,
  getSkillsPathForLocation,
  type InstallLocation,
  installSkillPackage,
  isPackageInstalled,
  type SkillPackage,
  updateSkills
} from "./utils/skill-installer.js"
import {
  DEFAULT_TMUX_CONFIG,
  generateSessionName,
  generateTmuxCommands,
  getTmuxInstallInstructions,
  isTmuxInstalled
} from "./utils/tmux-helpers.js"
import { loadUserConfig, saveUserConfig } from "./utils/user-config.js"
import { checkForUpdates, getUpgradeCommand, performUpgrade } from "./utils/version-check.js"

// Global error handlers to log crashes
const crashLogPath = join(ensureD3kHomeDir(), "crash.log")

function logCrash(type: string, error: Error | unknown): void {
  try {
    ensureD3kHomeDir()
    const timestamp = new Date().toISOString()
    const errorStr = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
    const logEntry = `[${timestamp}] ${type}: ${errorStr}\n\n`
    appendFileSync(crashLogPath, logEntry)
    console.error(chalk.red(`\n💥 d3k crashed: ${error instanceof Error ? error.message : error}`))
    console.error(chalk.gray(`   Details logged to: ${crashLogPath}`))
  } catch {
    // If we can't log, at least print to stderr
    console.error(`d3k crashed: ${error}`)
  }
}

function triggerEmergencyShutdown(reason: string, error: Error | unknown): boolean {
  const handler = globalThis.__d3kEmergencyShutdown
  if (typeof handler === "function") {
    try {
      handler(reason, error)
      return true
    } catch {
      return false
    }
  }
  return false
}

process.on("uncaughtException", (error) => {
  logCrash("Uncaught Exception", error)
  if (!triggerEmergencyShutdown("uncaughtException", error)) {
    process.exit(1)
  }
})

process.on("unhandledRejection", (reason) => {
  logCrash("Unhandled Promise Rejection", reason)
  if (!triggerEmergencyShutdown("unhandledRejection", reason)) {
    process.exit(1)
  }
})

/**
 * Options that should be forwarded to the d3k process spawned by tmux.
 */
interface ForwardedOptions {
  port?: string
  script?: string
  command?: string
  profileDir?: string
  browser?: string
  serversOnly?: boolean
  headless?: boolean
  dateTime?: string
  pluginReactScan?: boolean
  agentName?: string
}

/**
 * Build the d3k command string with forwarded options.
 */
function buildD3kCommandWithOptions(options: ForwardedOptions): string {
  const d3kBase = process.argv[1].endsWith("d3k") ? "d3k" : "dev3000"
  const args: string[] = [d3kBase]

  // Forward options that were explicitly set
  if (options.port) args.push(`--port ${options.port}`)
  if (options.script) args.push(`--script ${options.script}`)
  if (options.command) args.push(`--command "${options.command.replace(/"/g, '\\"')}"`)
  if (options.profileDir) args.push(`--profile-dir "${options.profileDir}"`)
  if (options.browser) args.push(`--browser "${options.browser}"`)
  if (options.serversOnly) args.push("--servers-only")
  if (options.headless) args.push("--headless")
  if (options.dateTime) args.push(`--date-time ${options.dateTime}`)
  if (options.pluginReactScan) args.push("--plugin-react-scan")
  if (options.agentName) args.push(`--agent-name ${options.agentName}`)

  return args.join(" ")
}

function ensureClaudeD3kSkill(): void {
  try {
    const bundledSkillsDir = getBundledSkillsPath()
    if (!bundledSkillsDir) return

    const bundledSkillPath = join(bundledSkillsDir, "d3k", "SKILL.md")
    if (!existsSync(bundledSkillPath)) return

    const skillsRoot = join(process.cwd(), ".claude", "skills")
    const skillDir = join(skillsRoot, "d3k")
    const skillPath = join(skillDir, "SKILL.md")

    const bundledContent = readFileSync(bundledSkillPath, "utf-8")
    if (existsSync(skillPath)) {
      const existingContent = readFileSync(skillPath, "utf-8")
      if (existingContent === bundledContent) {
        return
      }
    }

    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true })
    }
    copyFileSync(bundledSkillPath, skillPath)
  } catch {
    // Ignore errors - skill installation is optional
  }
}

/**
 * Launch d3k with an agent using tmux for proper terminal multiplexing.
 * This creates a split-screen with the agent on the left and d3k logs on the right.
 */
async function launchWithTmux(agentCommand: string, forwardedOptions: ForwardedOptions = {}): Promise<void> {
  const { execSync } = await import("child_process")
  const { appendFileSync, writeFileSync } = await import("fs")

  // Log file for debugging crashes
  const d3kDir = ensureD3kHomeDir()
  const crashLogPath = join(d3kDir, "crash.log")

  const logCrash = (message: string, error?: unknown) => {
    const timestamp = new Date().toISOString()
    const errorStr = error instanceof Error ? `${error.message}\n${error.stack}` : String(error || "")
    const logEntry = `[${timestamp}] ${message}${errorStr ? `\n${errorStr}` : ""}\n`
    try {
      appendFileSync(crashLogPath, logEntry)
    } catch {
      // Ignore write errors
    }
    console.error(chalk.red(message))
    if (error) console.error(error)
  }

  // Check if tmux is installed
  if (!(await isTmuxInstalled())) {
    console.error(chalk.red("\n❌ tmux is not installed."))
    console.error(chalk.yellow("\nThe --with-agent flag requires tmux for split-screen mode."))
    console.error(chalk.cyan("\nTo install tmux:"))
    for (const instruction of getTmuxInstallInstructions()) {
      console.error(chalk.gray(`  ${instruction}`))
    }
    console.error(chalk.yellow("\nAlternatively, run d3k and your agent in separate terminal tabs.\n"))
    process.exit(1)
  }

  // Generate a unique session name
  const sessionName = generateSessionName()

  // Build d3k command with forwarded options
  const d3kCommand = buildD3kCommandWithOptions(forwardedOptions)

  // Generate tmux commands using the helper
  const commands = generateTmuxCommands({
    sessionName,
    d3kCommand,
    agentCommand,
    paneWidthPercent: DEFAULT_TMUX_CONFIG.paneWidthPercent
  })

  // Create a shell script that sets up tmux and attaches
  // This ensures clean terminal state by exec'ing into tmux
  const scriptPath = join(d3kDir, "launch-tmux.sh")

  // Get the first command (new-session) and remaining commands
  const [newSessionCmd, ...remainingCommands] = commands
  // Modify new-session to include terminal dimensions (detected at runtime)
  // This ensures the 80/20 split ratio is maintained when the window is resized on attach
  const newSessionWithSize = newSessionCmd.replace("tmux new-session -d", "tmux new-session -d -x $COLS -y $LINES")

  const scriptContent = `#!/bin/bash
# Reset terminal state
stty sane 2>/dev/null || true
reset 2>/dev/null || true

# Get terminal dimensions for proper pane sizing
COLS=$(tput cols)
LINES=$(tput lines)

# Setup tmux session with actual terminal size
${newSessionWithSize} && \\
${remainingCommands.join(" && \\\n")}

# Replace this process with tmux attach
exec tmux attach-session -t "${sessionName}"
`

  try {
    // Write the launch script
    writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

    // Spawn bash with the script, inheriting stdio
    // The script will exec into tmux, replacing bash
    const { spawnSync } = await import("child_process")
    const result = spawnSync("bash", [scriptPath], {
      stdio: "inherit",
      shell: false
    })

    // Clean up session on exit
    try {
      execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null`, { stdio: "ignore" })
    } catch {
      // Session might already be killed
    }

    // Clear screen and print exit message
    process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
    console.log(chalk.gray("Thanks for using d3k!"))

    process.exit(result.status || 0)
  } catch (error) {
    logCrash("Failed to start tmux session", error)
    process.exit(1)
  }
}

/**
 * Show interactive agent selection prompt using Ink.
 * Returns the selected agent config, or null if user chose "No agent".
 */
async function promptAgentSelection(defaultAgentName?: string): Promise<{ name: string; command: string } | null> {
  const { render } = await import("ink")
  const React = await import("react")
  const { AgentSelector } = await import("./components/AgentSelector.js")

  const agents = getAvailableAgents()

  // Store the result to return after Ink exits
  let selectedResult: { name: string; command: string } | null = null

  try {
    const { unmount, waitUntilExit, clear } = render(
      React.createElement(AgentSelector, {
        agents,
        defaultAgentName,
        onComplete: (result: { agent: { name: string; command: string } | null }) => {
          selectedResult = result.agent
          // Always save the selection for next time
          try {
            if (result.agent) {
              saveUserConfig({ defaultAgent: result.agent })
            } else {
              // User chose "No agent" - clear the saved default
              saveUserConfig({ defaultAgent: undefined })
            }
          } catch (_error) {
            console.warn(chalk.yellow("Warning: Could not save agent preference"))
          }
          // Clear the Ink output and unmount
          clear()
          unmount()
        }
      })
    )

    // Wait for Ink to fully exit
    await waitUntilExit()

    // Clear terminal and scrollback to remove any Ink artifacts
    process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
  } catch (error) {
    console.error(chalk.red("Error in agent selection:"), error)
    return null
  }

  return selectedResult
}

interface PackageWithStatus extends SkillPackage {
  installed: boolean
}

/**
 * Show interactive skill selection prompt using Ink.
 * Returns the selected skills and install location, or empty array if user skipped.
 */
async function promptPackageSelection(
  packages: PackageWithStatus[],
  agentId?: string | null
): Promise<{ packages: SkillPackage[]; location: InstallLocation }> {
  const { render } = await import("ink")
  const React = await import("react")
  const { PackageSelector } = await import("./components/PackageSelector.js")

  let selectedPackages: SkillPackage[] = []
  let installLocation: InstallLocation = "project"

  try {
    const { unmount, waitUntilExit, clear } = render(
      React.createElement(PackageSelector, {
        packages,
        agentId,
        onComplete: (selected: SkillPackage[], location: InstallLocation) => {
          selectedPackages = selected
          installLocation = location
          clear()
          unmount()
        },
        onSkip: () => {
          clear()
          unmount()
        }
      })
    )

    await waitUntilExit()

    // Clear terminal and scrollback to remove any Ink artifacts
    process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
  } catch (error) {
    console.error(chalk.red("Error in package selection:"), error)
    return { packages: [], location: "project" }
  }

  return { packages: selectedPackages, location: installLocation }
}

interface ProjectConfig {
  type: "node" | "python" | "rails"
  framework?: "nextjs" | "svelte" | "other" // For node projects
  packageManager?: string // Only for node projects
  pythonCommand?: string // Only for python projects
  defaultScript: string
  defaultPort: string
  noProjectDetected?: boolean // True if no valid project was found
}

function detectPythonCommand(debug = false): string {
  // Check if we're in a virtual environment
  if (process.env.VIRTUAL_ENV) {
    if (debug) {
      console.log(`[DEBUG] Virtual environment detected: ${process.env.VIRTUAL_ENV}`)
      console.log(`[DEBUG] Using activated python command`)
    }
    return "python"
  }

  // Check if python3 is available and prefer it
  try {
    require("child_process").execSync("python3 --version", { stdio: "ignore" })
    if (debug) {
      console.log(`[DEBUG] python3 is available, using python3`)
    }
    return "python3"
  } catch {
    if (debug) {
      console.log(`[DEBUG] python3 not available, falling back to python`)
    }
    return "python"
  }
}

async function detectProjectType(debug = false): Promise<ProjectConfig> {
  // Helper to check if package.json has a dev script (indicates Node.js project)
  const hasNodeDevScript = (): boolean => {
    try {
      if (existsSync("package.json")) {
        const packageJson = JSON.parse(readFileSync("package.json", "utf-8"))
        return !!packageJson.scripts?.dev
      }
    } catch {
      // Ignore parse errors
    }
    return false
  }

  // Check for Node.js project FIRST if package.json has a dev script
  // This takes priority over Python/Rails detection for hybrid projects
  const detected = await detect()
  if (detected && hasNodeDevScript()) {
    if (debug) {
      console.log(`[DEBUG] Node.js project detected (package.json with dev script takes priority)`)
    }
    // Continue to Node.js detection below
  } else {
    // Check for Python project (only if no Node.js dev script)
    if (existsSync("requirements.txt") || existsSync("pyproject.toml")) {
      if (debug) {
        console.log(`[DEBUG] Python project detected (found requirements.txt or pyproject.toml)`)
      }
      return {
        type: "python",
        defaultScript: "main.py",
        defaultPort: "8000", // Common Python web server port
        pythonCommand: detectPythonCommand(debug)
      }
    }

    // Check for Rails project
    if (existsSync("Gemfile") && existsSync("config/application.rb")) {
      if (debug) {
        console.log(`[DEBUG] Rails project detected (found Gemfile and config/application.rb)`)
      }
      return {
        type: "rails",
        defaultScript: "server",
        defaultPort: "3000" // Rails default port
      }
    }
  }

  // Helper to detect framework for Node.js projects
  const detectFramework = (): "nextjs" | "svelte" | "other" => {
    // Check for Next.js
    const nextConfigFiles = ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"]
    if (nextConfigFiles.some((file) => existsSync(file))) {
      if (debug) {
        console.log(`[DEBUG] Next.js framework detected`)
      }
      return "nextjs"
    }

    // Check for Svelte - look for svelte.config.js or svelte dependency
    if (existsSync("svelte.config.js")) {
      if (debug) {
        console.log(`[DEBUG] Svelte framework detected (svelte.config.js)`)
      }
      return "svelte"
    }

    // Check package.json for svelte dependency
    try {
      if (existsSync("package.json")) {
        const packageJson = JSON.parse(readFileSync("package.json", "utf-8"))
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        if (deps.svelte || deps["@sveltejs/kit"]) {
          if (debug) {
            console.log(`[DEBUG] Svelte framework detected (package.json dependency)`)
          }
          return "svelte"
        }
      }
    } catch {
      // Ignore parse errors
    }

    return "other"
  }

  if (detected) {
    const framework = detectFramework()
    if (debug) {
      console.log(`[DEBUG] Node.js project detected with ${detected.agent} package manager and ${framework} framework`)
    }
    return {
      type: "node",
      framework,
      packageManager: detected.agent,
      defaultScript: "dev",
      defaultPort: "3000"
    }
  }

  // Check if this is a valid project directory
  // If we get here, no lock files or project markers were found
  // Check if package.json exists - if not, this isn't a valid project directory
  if (!existsSync("package.json")) {
    if (debug) {
      console.log(`[DEBUG] No project files detected - not a valid project directory`)
    }
    return {
      type: "node",
      framework: "other",
      packageManager: "npm",
      defaultScript: "dev",
      defaultPort: "3000",
      noProjectDetected: true // Flag to indicate no project was found
    }
  }

  // Fallback to npm for Node.js (package.json exists but no lock file)
  const framework = detectFramework()
  if (debug) {
    console.log(
      `[DEBUG] Node.js project detected (package.json exists, no lock file), defaulting to npm and ${framework} framework`
    )
  }
  return {
    type: "node",
    framework,
    packageManager: "npm",
    defaultScript: "dev",
    defaultPort: "3000"
  }
}

// Declare the compile-time injected version (set by bun build --define)
declare const __D3K_VERSION__: string | undefined

// Read version from package.json or use compile-time injected version
function getVersion(): string {
  // Check for compile-time injected version first (for standalone binaries)
  if (typeof __D3K_VERSION__ !== "undefined") {
    return __D3K_VERSION__
  }

  try {
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(currentFile)) // Go up from dist/ to package root
    const packageJsonPath = join(packageRoot, "package.json")
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    let version = packageJson.version

    // Use git to detect if we're in the dev3000 source repository
    try {
      const { execSync } = require("child_process")
      const gitRemote = execSync("git remote get-url origin 2>/dev/null", {
        cwd: packageRoot,
        encoding: "utf8"
      }).trim()

      if (gitRemote.includes("vercel-labs/dev3000") && !version.includes("canary")) {
        version += "-local"
      }
    } catch {
      // Not in git repo or no git - use version as-is
    }

    return version
  } catch (_error) {
    return "0.0.0" // fallback
  }
}

// Check if installed globally before proceeding
function checkGlobalInstall() {
  const currentFile = fileURLToPath(import.meta.url)
  const packageRoot = dirname(dirname(currentFile))

  // Check common global install paths
  const globalPaths = [
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
    process.env.NPM_CONFIG_PREFIX && join(process.env.NPM_CONFIG_PREFIX, "lib/node_modules"),
    process.env.PNPM_HOME,
    process.platform === "win32" && process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules"),
    process.env.HOME && join(process.env.HOME, ".npm-global/lib/node_modules"),
    process.env.HOME && join(process.env.HOME, ".pnpm"),
    process.env.HOME && join(process.env.HOME, ".yarn/global/node_modules")
  ].filter(Boolean) as string[]

  // Check if our package path contains any of these global paths
  for (const globalPath of globalPaths) {
    if (packageRoot.includes(globalPath)) {
      return true
    }
  }

  // Additional check: if we're in node_modules but not in a project's node_modules
  if (packageRoot.includes("node_modules") && !existsSync(join(packageRoot, "..", "..", "..", "package.json"))) {
    return true
  }

  // If we're in dev (running from source), that's fine
  if (!packageRoot.includes("node_modules")) {
    return true
  }

  return false
}

// Perform the check
if (!checkGlobalInstall()) {
  console.error(chalk.red("\n❌ Error: dev3000 must be installed globally.\n"))
  console.error(chalk.white("This package won't work correctly as a local dependency.\n"))
  console.error(chalk.cyan("To install globally, use one of these commands:"))
  console.error(chalk.gray("  pnpm install -g dev3000"))
  console.error(chalk.gray("  npm install -g dev3000"))
  console.error(chalk.gray("  yarn global add dev3000\n"))
  console.error(chalk.white("Then run 'd3k' or 'dev3000' from any project directory.\n"))
  process.exit(1)
}

const program = new Command()

program
  .name("dev3000")
  .description("AI-powered development tools with browser monitoring and tool integrations")
  .version(getVersion())

program
  .description("AI-powered development tools with browser monitoring and tool integrations")
  .option("-p, --port <port>", "Development server port (auto-detected by project type)")
  .option("-s, --script <script>", "Script to run (e.g. dev, main.py) - auto-detected by project type")
  .option("-c, --command <command>", "Custom command to run (overrides auto-detection and --script)")
  .option("--profile-dir <dir>", "Chrome profile directory", join(tmpdir(), "dev3000-chrome-profile"))
  .option(
    "--browser <path>",
    "Full path to browser executable (e.g. for Arc: '/Applications/Arc.app/Contents/MacOS/Arc')"
  )
  .option("--servers-only", "Run servers only, skip browser launch")
  .option("--debug", "Enable debug logging to console (automatically disables TUI)")
  .option("-t, --tail", "Output consolidated logfile to terminal (like tail -f)")
  .option("--no-tui", "Disable TUI mode and use standard terminal output")
  .option(
    "--date-time <format>",
    "Timestamp format: 'local' (default, e.g. 12:54:03 PM) or 'utc' (ISO string)",
    "local"
  )
  .option("--plugin-react-scan", "Enable react-scan performance monitoring for React applications")
  .option("--headless", "Run Chrome in headless mode (for serverless/CI environments)")
  .option(
    "--auto-skills",
    "Automatically install recommended skills without prompts (headless-safe, installs to project skills dir)"
  )
  .option("--no-skills", "Disable skill installation and update checks")
  .option(
    "--with-agent <command>",
    'Run an agent (e.g. claude) in split-screen mode using tmux. Example: --with-agent "claude"'
  )
  .option("--agent-name <name>", "Selected agent name (internal)")
  .option("--no-agent", "Skip agent selection prompt and run d3k standalone")
  .action(async (options) => {
    // Load user config early so it can be used for --with-agent and agent selection flows
    const userConfig = loadUserConfig()

    // Apply browser default from user config if not explicitly provided via CLI
    const browserOption = options.browser || userConfig.browser

    // Handle --with-agent by spawning tmux with split panes
    if (options.withAgent) {
      await launchWithTmux(options.withAgent, {
        port: options.port,
        script: options.script,
        command: options.command,
        profileDir: options.profileDir,
        browser: browserOption,
        serversOnly: options.serversOnly,
        headless: options.headless,
        dateTime: options.dateTime,
        pluginReactScan: options.pluginReactScan,
        agentName: options.agentName
      })
      return
    }
    // Handle agent selection for split-screen mode (default behavior in TTY)
    // Skip if --no-agent, --no-tui, --debug flags are used, or if already inside tmux (to avoid nested prompts)
    const insideTmux = !!process.env.TMUX
    let selectedAgent: { name: string; command: string } | null = null
    let didPromptAgentSelection = false
    let skillsAgentId: string | null = options.agentName ? getSkillsAgentId(options.agentName) : null

    if (process.stdin.isTTY && options.agent !== false && options.tui !== false && !options.debug && !insideTmux) {
      // Clear the terminal so d3k UI starts at the top of the screen
      process.stdout.write("\x1B[2J\x1B[0f")

      // Check if tmux is available before showing prompt
      const tmuxAvailable = await isTmuxInstalled()
      if (!tmuxAvailable) {
        console.warn(chalk.yellow("⚠️ tmux not installed - agent split-screen mode unavailable"))
        console.warn(chalk.gray("  Install tmux to enable: brew install tmux (macOS)"))
        // Continue with normal startup
      } else {
        // Always show prompt, pre-selecting the last-used option
        selectedAgent = await promptAgentSelection(userConfig.defaultAgent?.name)
        didPromptAgentSelection = true

        if (selectedAgent) {
          if (selectedAgent.name === "debug") {
            // User chose debug mode - enable debug and continue with normal startup
            options.debug = true
          }
        } else if (options.debug) {
          console.log("[DEBUG] No agent selected, continuing with normal startup")
        }
        // User chose "No agent" or "debug" - continue with normal startup
      }

      const skillsAgentName =
        selectedAgent?.name && selectedAgent.name !== "debug"
          ? selectedAgent.name
          : !didPromptAgentSelection
            ? userConfig.defaultAgent?.name
            : undefined
      skillsAgentId = getSkillsAgentId(skillsAgentName)

      if (skillsAgentId && options.skills !== false) {
        const resolvedSkillsAgentId = skillsAgentId
        // Check for skill updates and offer new packages
        try {
          // Show loading message
          process.stdout.write(chalk.gray(" Checking for skills...\r"))

          // 1. Check for updates to existing skills
          const { hasUpdates } = await checkForSkillUpdates()

          // Clear the loading message line
          process.stdout.write("\x1B[2K\r")

          if (hasUpdates) {
            // Show which packages have updates (use applicable packages since lock file may not exist)
            const applicablePackages = getApplicablePackages()

            console.log(chalk.cyan("📦 Skill updates available"))
            for (const pkg of applicablePackages) {
              console.log(chalk.gray(`   • ${pkg.repo}`))
            }
            const { default: readline } = await import("readline")
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
            const answer = await new Promise<string>((resolve) => {
              rl.question(chalk.white("   Update now? (Y/n) "), resolve)
            })
            rl.close()

            if (answer.toLowerCase() !== "n") {
              console.log(chalk.gray("   Updating skills..."))
              const updateResult = await updateSkills()
              if (updateResult.success) {
                console.log(chalk.green("   ✓ Skills updated"))
              } else {
                console.log(chalk.yellow("   ⚠ Some skills failed to update"))
              }
            }
            console.log("")
          }

          // 2. Show all applicable packages with install status
          // Skip if we just handled updates
          if (!hasUpdates) {
            const applicablePackages = getApplicablePackages()
            const packagesWithStatus: PackageWithStatus[] = applicablePackages.map((pkg) => ({
              ...pkg,
              installed: isPackageInstalled(pkg, resolvedSkillsAgentId)
            }))
            const hasUninstalled = packagesWithStatus.some((p) => !p.installed)

            // Only show package selector if there are packages to install
            if (packagesWithStatus.length > 0 && hasUninstalled) {
              const { packages: selectedPackages, location } = await promptPackageSelection(
                packagesWithStatus,
                resolvedSkillsAgentId
              )
              if (selectedPackages.length > 0) {
                const locationLabel = location === "global" ? "globally" : "to project"
                const targetPath = getSkillsPathForLocation(resolvedSkillsAgentId, location)
                if (targetPath) {
                  const displayPath = targetPath.path.replace(process.env.HOME || "", "~")
                  console.log(
                    chalk.cyan(
                      `Installing ${selectedPackages.length} skill package(s) ${locationLabel} → ${displayPath}...`
                    )
                  )
                } else {
                  console.log(chalk.cyan(`Installing ${selectedPackages.length} skill package(s) ${locationLabel}...`))
                }

                const results = { success: [] as string[], failed: [] as string[] }
                for (let i = 0; i < selectedPackages.length; i++) {
                  const pkg = selectedPackages[i]
                  console.log(chalk.gray(`  [${i + 1}/${selectedPackages.length}] ${pkg.displayName}...`))
                  const result = await installSkillPackage(pkg, location, resolvedSkillsAgentId)
                  if (result.success) {
                    results.success.push(pkg.displayName)
                  } else {
                    results.failed.push(pkg.displayName)
                  }
                }

                if (results.success.length > 0) {
                  console.log(chalk.green(`✓ Installed: ${results.success.join(", ")}`))
                }
                if (results.failed.length > 0) {
                  console.log(chalk.yellow(`⚠ Failed: ${results.failed.join(", ")}`))
                }
                console.log("")
              } else {
                // User skipped package installation, show skills are up to date
                console.log(chalk.green("✓ Skills up to date"))
                console.log("")
              }
            } else {
              // No updates and no new packages - show success
              console.log(chalk.green("✓ Skills up to date"))
              console.log("")
            }
          }
        } catch {
          // Show error briefly, then continue
          console.log(chalk.yellow("⚠ Could not check for skill updates"))
          console.log("")
        }
      }

      if (tmuxAvailable && selectedAgent && selectedAgent.name !== "debug") {
        // User selected an agent - launch with tmux after skills install
        if (options.debug) {
          console.log(`[DEBUG] Launching tmux with agent command: ${selectedAgent.command}`)
        }
        if (skillsAgentId === "claude-code" && options.skills !== false) {
          ensureClaudeD3kSkill()
        }
        // Clear screen and scrollback before launching tmux so when tmux exits, terminal is clean
        process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
        await launchWithTmux(selectedAgent.command, {
          port: options.port,
          script: options.script,
          command: options.command,
          profileDir: options.profileDir,
          browser: browserOption,
          serversOnly: options.serversOnly,
          headless: options.headless,
          dateTime: options.dateTime,
          pluginReactScan: options.pluginReactScan
        })
        return
      }
    }

    if (options.autoSkills && options.skills !== false && !skillsAgentId) {
      skillsAgentId = "codex"
    }

    // Detect project type and configuration
    const projectConfig = await detectProjectType(options.debug)

    // Check if we're in a valid project directory
    if (projectConfig.noProjectDetected) {
      console.error(chalk.red("\n❌ No project detected in current directory.\n"))
      console.error(chalk.white("dev3000 requires a project with one of these files:"))
      console.error(chalk.gray("  • package.json (Node.js/JavaScript)"))
      console.error(chalk.gray("  • requirements.txt or pyproject.toml (Python)"))
      console.error(chalk.gray("  • Gemfile + config/application.rb (Rails)\n"))
      console.error(chalk.cyan("💡 To get started:"))
      console.error(chalk.gray("  • Navigate to an existing project directory, or"))
      console.error(chalk.gray("  • Create a new project (e.g., 'npx create-next-app@latest'), or"))
      console.error(chalk.gray("  • Use --command to run a custom command:\n"))
      console.error(chalk.yellow(`    d3k --command "node server.js" -p 3000\n`))
      process.exit(1)
    }

    // Detect if running under an AI agent and auto-disable TUI
    const agentDetection = detectAIAgent()
    if (agentDetection.isAgent && options.tui !== false) {
      if (options.debug) {
        console.log(
          `[DEBUG] AI agent detected: ${agentDetection.agentName} (${agentDetection.reason}), auto-disabling TUI`
        )
      }
      // Override TUI setting to false when agent is detected
      options.tui = false
    }

    // Use defaults from project detection if not explicitly provided
    const port = options.port || projectConfig.defaultPort
    const script = options.script || projectConfig.defaultScript
    const userSetPort = options.port !== undefined
    // Generate server command based on custom command or project type
    let serverCommand: string
    if (options.command) {
      // Use custom command if provided - this overrides everything
      serverCommand = options.command
      if (options.debug) {
        console.log(`[DEBUG] Using custom command: ${serverCommand}`)
      }
    } else if (projectConfig.type === "python") {
      serverCommand = `${projectConfig.pythonCommand} ${script}`
      // Python frameworks typically use --port or -p, but it varies by framework
      // For now, we'll let users handle Python port config manually
    } else if (projectConfig.type === "rails") {
      serverCommand = `bundle exec rails ${script}`
      // Append port for Rails when user explicitly sets it
      if (userSetPort) {
        serverCommand += ` -p ${port}`
      }
    } else {
      // Node.js project
      serverCommand = `${projectConfig.packageManager} run ${script}`
      // Append port for Node.js projects when user explicitly sets it
      if (userSetPort) {
        // Different frameworks need different port argument syntax
        // Note: We don't use -- separator as it conflicts with scripts that already have args
        if (projectConfig.framework === "nextjs") {
          // Next.js uses -p or --port flag
          serverCommand += ` -p ${port}`
        } else {
          // Other frameworks (Vite, etc.) typically use --port
          serverCommand += ` --port ${port}`
        }
      }
    }

    // Check for circular dependency - detect if the script would invoke dev3000 itself
    // Skip this check if using a custom command
    if (projectConfig.type === "node" && !options.command) {
      try {
        const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
        const scriptContent = packageJson.scripts?.[script]

        // Check if the script invokes dev3000 or d3k
        if (scriptContent && (scriptContent.includes("dev3000") || /\bd3k\b/.test(scriptContent))) {
          console.error(chalk.red(`\n❌ Circular dependency detected!`))
          console.error(
            chalk.yellow(
              `   The "${script}" script in package.json calls dev3000, which would create an infinite loop.`
            )
          )
          console.error(chalk.yellow(`   Current script content: "${scriptContent}"`))
          console.error(chalk.yellow(`\n💡 Fix this by either:`))
          console.error(chalk.yellow(`   1. Change the "${script}" script to call your actual dev server`))
          console.error(
            chalk.yellow(`   2. Use dev3000 globally (run 'd3k' directly) instead of via package.json scripts`)
          )
          console.error(
            chalk.yellow(
              `   3. Use a different script name that doesn't invoke dev3000 (e.g., '${script === "dev" ? "dev:next" : "dev:server"}')`
            )
          )
          process.exit(1)
        }
      } catch (_error) {
        // Ignore errors reading package.json
      }
    }

    if (options.debug) {
      console.log(`[DEBUG] Project type: ${projectConfig.type}`)
      console.log(`[DEBUG] Port: ${port} (${options.port ? "explicit" : "auto-detected"})`)
      console.log(`[DEBUG] Script: ${script} (${options.script ? "explicit" : "auto-detected"})`)
      console.log(`[DEBUG] Server command: ${serverCommand}`)
    }

    // Detect which command name was used (dev3000 or d3k)
    const executablePath = process.argv[1]
    const commandName = executablePath.endsWith("/d3k") || executablePath.includes("/d3k") ? "d3k" : "dev3000"

    try {
      // Create persistent log file
      const logFile = createPersistentLogFile()

      // Get project directory for chrome profile
      const profileDir = join(getProjectDir(), "chrome-profile")

      // Find available Chrome debug port (starting from 9222)
      // Each d3k instance needs its own debug port to avoid conflicts
      const debugPort = await findAvailablePort(9222)

      await startDevEnvironment({
        ...options,
        browser: browserOption,
        port,
        debugPort: Number.parseInt(debugPort, 10),
        defaultPort: projectConfig.defaultPort,
        framework: projectConfig.framework,
        userSetPort,
        logFile,
        profileDir,
        serverCommand,
        debug: options.debug,
        serversOnly: options.serversOnly,
        commandName,
        tail: options.tail,
        tui: options.tui && !options.debug, // TUI is default unless --no-tui or --debug is specified
        dateTimeFormat: options.dateTime || "local",
        pluginReactScan: options.pluginReactScan || false,
        skillsAgentId: skillsAgentId || undefined,
        autoSkills: options.skills !== false ? options.autoSkills || false : false,
        installSkills: options.skills !== false
      })
    } catch (error) {
      console.error(chalk.red("❌ Failed to start development environment:"), error)
      process.exit(1)
    }
  })

// Cloud commands
const cloud = program.command("cloud").description("Cloud-based tools using Vercel Sandbox")

// Cloud fix command
cloud
  .command("fix")
  .description("Start a cloud fix workflow for the current project")
  .option("--repo <url>", "Repository URL (e.g. https://github.com/user/repo)")
  .option("--branch <name>", "Git branch to test")
  .option("--project-dir <dir>", "Project directory within repo (e.g. 'www')")
  .option("--debug", "Enable debug logging")
  .action(async (options) => {
    try {
      await cloudFix(options)
    } catch (error) {
      console.error(chalk.red("❌ Cloud fix failed:"), error)
      process.exit(1)
    }
  })

// Cloud check-pr command
cloud
  .command("check-pr [pr-number]")
  .description("Verify a PR's changes work as expected using Vercel preview deployment")
  .option("--repo <url>", "Repository URL (optional, auto-detected from git)")
  .option("--url <preview-url>", "Preview deployment URL (optional, auto-detected from Vercel)")
  .option("--debug", "Enable debug logging")
  .action(async (prNumber, options) => {
    try {
      await cloudCheckPR({ ...options, prNumber })
    } catch (error) {
      console.error(chalk.red("❌ Cloud check-pr failed:"), error)
      process.exit(1)
    }
  })

// Upgrade command
program
  .command("upgrade")
  .description("Upgrade dev3000 to the latest version")
  .option("--check", "Only check for updates without upgrading")
  .action(async (options) => {
    console.log(chalk.cyan("Checking for updates...\n"))

    const versionInfo = await checkForUpdates()

    console.log(chalk.white(`Current version: ${chalk.yellow(versionInfo.currentVersion)}`))

    if (versionInfo.latestVersion) {
      console.log(chalk.white(`Latest version:  ${chalk.green(versionInfo.latestVersion)}`))
    } else {
      console.log(chalk.gray("Could not fetch latest version from npm registry"))
    }

    if (!versionInfo.updateAvailable) {
      console.log(chalk.green("\n✓ You're already on the latest version!"))
      process.exit(0)
    }

    console.log(chalk.yellow(`\n↑ Update available: ${versionInfo.currentVersion} → ${versionInfo.latestVersion}`))

    if (options.check) {
      const upgradeCmd = getUpgradeCommand(versionInfo.packageManager)
      console.log(chalk.cyan(`\nTo upgrade, run: ${chalk.white(upgradeCmd)}`))
      console.log(chalk.gray(`Or run: ${chalk.white("d3k upgrade")}`))
      process.exit(0)
    }

    console.log("")
    const result = performUpgrade()

    if (result.success) {
      console.log(chalk.green("\n✓ Upgrade completed successfully!"))
      console.log(chalk.gray("Run 'd3k --version' to verify the new version."))
    } else {
      console.error(chalk.red(`\n✗ Upgrade failed: ${result.error}`))
      const upgradeCmd = getUpgradeCommand(versionInfo.packageManager)
      console.log(chalk.yellow(`\nTry running manually: ${chalk.white(upgradeCmd)}`))
      process.exit(1)
    }
  })

// Agent-browser command - registered for --help display only
// Actual handling happens at the top of the file before Commander runs
program
  .command("agent-browser [args...]")
  .description("Run the bundled agent-browser CLI (e.g., d3k agent-browser screenshot /tmp/foo.png)")
  .allowUnknownOption(true)

// Skill command - get skill content for use in prompts/workflows
program
  .command("skill [name]")
  .description("Get skill content or list available skills")
  .option("-l, --list", "List all available skills")
  .option("-v, --verbose", "Show detailed skill information")
  .action((name, options) => {
    // List skills if --list flag or no name provided
    if (options.list || !name) {
      if (options.verbose) {
        const skills = getSkillsInfo()
        if (skills.length === 0) {
          console.log(chalk.yellow("No skills found."))
          console.log(chalk.gray("\nSkills are loaded from:"))
          console.log(chalk.gray("  • .agents/skills/ (project-local)"))
          console.log(chalk.gray("  • d3k built-in skills"))
          process.exit(0)
        }

        console.log(chalk.cyan("Available skills:\n"))
        for (const skill of skills) {
          console.log(chalk.white(`  ${chalk.bold(skill.name)}`))
          console.log(chalk.gray(`    ${skill.description}`))
          console.log(chalk.gray(`    Path: ${skill.path}\n`))
        }
      } else {
        const skills = listAvailableSkills()
        if (skills.length === 0) {
          console.log(chalk.yellow("No skills found."))
          process.exit(0)
        }

        console.log(chalk.cyan("Available skills:"))
        for (const skill of skills) {
          console.log(chalk.white(`  • ${skill}`))
        }
        console.log(chalk.gray("\nUse 'd3k skill <name>' to get skill content"))
        console.log(chalk.gray("Use 'd3k skill --list --verbose' for details"))
      }
      process.exit(0)
    }

    // Get specific skill content
    const result = getSkill(name)

    if (!result.found) {
      console.error(chalk.red(`Error: ${result.error}`))
      if (result.availableSkills && result.availableSkills.length > 0) {
        console.log(chalk.yellow("\nAvailable skills:"))
        for (const skill of result.availableSkills) {
          console.log(chalk.gray(`  • ${skill}`))
        }
      }
      process.exit(1)
    }

    // Output skill content to stdout (no formatting, for piping/parsing)
    console.log(result.content)
  })

// Errors command - quick view of recent errors
program
  .command("errors")
  .description("Show recent errors from d3k logs (browser + server)")
  .option("-n, --count <count>", "Number of errors to show", "10")
  .option("-a, --all", "Show all errors, not just recent")
  .option("-c, --context", "Show interactions before each error (for replay)")
  .option("--json", "Output as JSON for parsing")
  .action(async (options) => {
    const { showErrors } = await import("./commands/errors.js")
    await showErrors(options)
  })

// Logs command - view recent logs
program
  .command("logs")
  .description("Show recent logs from d3k (browser + server)")
  .option("-n, --count <count>", "Number of lines to show", "50")
  .option("-t, --type <type>", "Filter by type: browser, server, network, all", "all")
  .option("--json", "Output as JSON for parsing")
  .action(async (options) => {
    const { showLogs } = await import("./commands/logs.js")
    await showLogs(options)
  })

// Fix command - diagnose application errors from logs
program
  .command("fix")
  .description("Diagnose application errors from d3k logs")
  .option("-f, --focus <area>", "Focus area: build, runtime, network, ui, all", "all")
  .option("-t, --time <minutes>", "Minutes to analyze back", "10")
  .option("--json", "Output as JSON for parsing")
  .action(async (options) => {
    const { fixMyApp } = await import("./commands/fix.js")
    await fixMyApp(options)
  })

// Crawl command - discover app URLs
program
  .command("crawl")
  .description("Discover URLs by crawling the app")
  .option("-d, --depth <depth>", "Crawl depth (1, 2, 3, or 'all')", "1")
  .option("-l, --limit <limit>", "Max links per page to follow", "3")
  .action(async (options) => {
    const { crawlApp } = await import("./commands/crawl.js")
    await crawlApp(options)
  })

// Find-component command - map DOM to React source
program
  .command("find-component <selector>")
  .description("Find React component source for a DOM selector")
  .action(async (selector) => {
    const { findComponent } = await import("./commands/find-component.js")
    await findComponent(selector)
  })

// CDP port command - get the CDP port from the session file
program
  .command("cdp-port")
  .description("Output the CDP port for the current d3k session (for use in scripts)")
  .action(async () => {
    const sessionDir = join(homedir(), ".d3k")
    const projectDir = getProjectDir()
    const projectName = projectDir.split("/").pop() || "unknown"

    // Try to find session.json in ~/.d3k/{project-name}/
    const entries = existsSync(sessionDir)
      ? await import("fs").then((fs) => fs.readdirSync(sessionDir, { withFileTypes: true }))
      : []

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(projectName.substring(0, 20))) {
        const sessionFile = join(sessionDir, entry.name, "session.json")
        if (existsSync(sessionFile)) {
          try {
            const content = JSON.parse(readFileSync(sessionFile, "utf-8"))
            if (content.cdpUrl) {
              // Extract port from URL like "ws://localhost:9223/devtools/browser/..."
              const match = content.cdpUrl.match(/:(\d+)/)
              if (match) {
                console.log(match[1])
                process.exit(0)
              }
            }
          } catch {
            // Continue searching
          }
        }
      }
    }

    // Default to 9222 if no session found
    console.log("9222")
  })

program.parse()

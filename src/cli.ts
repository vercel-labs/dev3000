#!/usr/bin/env bun

import chalk from "chalk"
import { Command } from "commander"
import { existsSync, readFileSync } from "fs"
import { homedir, tmpdir } from "os"
import { detect } from "package-manager-detector"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { cloudCheckPR } from "./commands/cloud-check-pr.js"
import { cloudFix } from "./commands/cloud-fix.js"
import { createPersistentLogFile, findAvailablePort, startDevEnvironment } from "./dev-environment.js"
import { getSkill, getSkillsInfo, listAvailableSkills } from "./skills/index.js"
import { detectAIAgent } from "./utils/agent-detection.js"
import { getAvailableAgents } from "./utils/agent-selection.js"
import { formatMcpConfigTargets, parseDisabledMcpConfigs } from "./utils/mcp-configs.js"
import { getProjectDir } from "./utils/project-name.js"
import {
  type AvailableSkill,
  checkForNewSkills,
  installSelectedSkills,
  markSkillsAsSeen
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

/**
 * Options that should be forwarded to the d3k process spawned by tmux.
 */
interface ForwardedOptions {
  port?: string
  portMcp?: string
  script?: string
  command?: string
  profileDir?: string
  browser?: string
  serversOnly?: boolean
  headless?: boolean
  dateTime?: string
  pluginReactScan?: boolean
  disableMcpConfigs?: string
  chromeDevtoolsMcp?: boolean
}

/**
 * Build the d3k command string with forwarded options.
 */
function buildD3kCommandWithOptions(options: ForwardedOptions): string {
  const d3kBase = process.argv[1].endsWith("d3k") ? "d3k" : "dev3000"
  const args: string[] = [d3kBase]

  // Forward options that were explicitly set
  if (options.port) args.push(`--port ${options.port}`)
  if (options.portMcp) args.push(`--port-mcp ${options.portMcp}`)
  if (options.script) args.push(`--script ${options.script}`)
  if (options.command) args.push(`--command "${options.command.replace(/"/g, '\\"')}"`)
  if (options.profileDir) args.push(`--profile-dir "${options.profileDir}"`)
  if (options.browser) args.push(`--browser "${options.browser}"`)
  if (options.serversOnly) args.push("--servers-only")
  if (options.headless) args.push("--headless")
  if (options.dateTime) args.push(`--date-time ${options.dateTime}`)
  if (options.pluginReactScan) args.push("--plugin-react-scan")
  if (options.disableMcpConfigs) args.push(`--disable-mcp-configs "${options.disableMcpConfigs}"`)
  if (options.chromeDevtoolsMcp === false) args.push("--no-chrome-devtools-mcp")

  return args.join(" ")
}

/**
 * Launch d3k with an agent using tmux for proper terminal multiplexing.
 * This creates a split-screen with the agent on the left and d3k logs on the right.
 */
async function launchWithTmux(
  agentCommand: string,
  mcpPort: number = DEFAULT_TMUX_CONFIG.mcpPort,
  forwardedOptions: ForwardedOptions = {}
): Promise<void> {
  const { execSync } = await import("child_process")
  const { appendFileSync, writeFileSync } = await import("fs")

  // Log file for debugging crashes
  const crashLogPath = join(homedir(), ".d3k", "crash.log")

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
    mcpPort,
    paneWidthPercent: DEFAULT_TMUX_CONFIG.paneWidthPercent
  })

  // Create a shell script that sets up tmux and attaches
  // This ensures clean terminal state by exec'ing into tmux
  const scriptPath = join(homedir(), ".d3k", "launch-tmux.sh")

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

/**
 * Show interactive skill selection prompt using Ink.
 * Returns the selected skills, or empty array if user skipped.
 */
async function promptSkillSelection(skills: AvailableSkill[]): Promise<AvailableSkill[]> {
  const { render } = await import("ink")
  const React = await import("react")
  const { SkillSelector } = await import("./components/SkillSelector.js")

  let selectedSkills: AvailableSkill[] = []
  let skipped = false

  try {
    const { unmount, waitUntilExit, clear } = render(
      React.createElement(SkillSelector, {
        skills,
        onComplete: (selected: AvailableSkill[]) => {
          selectedSkills = selected
          clear()
          unmount()
        },
        onSkip: () => {
          skipped = true
          clear()
          unmount()
        }
      })
    )

    await waitUntilExit()

    // Clear terminal and scrollback to remove any Ink artifacts
    process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
  } catch (error) {
    console.error(chalk.red("Error in skill selection:"), error)
    return []
  }

  // If user skipped, mark skills as seen so we don't ask again
  if (skipped) {
    markSkillsAsSeen(skills)
  }

  return selectedSkills
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
  .description("AI-powered development tools with browser monitoring and MCP server")
  .version(getVersion())

program
  .description("AI-powered development tools with browser monitoring and MCP server")
  .option("-p, --port <port>", "Development server port (auto-detected by project type)")
  .option("-m, --port-mcp <port>", "MCP server port", "3684")
  .option("-s, --script <script>", "Script to run (e.g. dev, main.py) - auto-detected by project type")
  .option("-c, --command <command>", "Custom command to run (overrides auto-detection and --script)")
  .option("--profile-dir <dir>", "Chrome profile directory", join(tmpdir(), "dev3000-chrome-profile"))
  .option(
    "--browser <path>",
    "Full path to browser executable (e.g. for Arc: '/Applications/Arc.app/Contents/MacOS/Arc')"
  )
  .option("--servers-only", "Run servers only, skip browser launch (use with Chrome extension)")
  .option("--debug", "Enable debug logging to console (automatically disables TUI)")
  .option("-t, --tail", "Output consolidated logfile to terminal (like tail -f)")
  .option("--no-tui", "Disable TUI mode and use standard terminal output")
  .option(
    "--date-time <format>",
    "Timestamp format: 'local' (default, e.g. 12:54:03 PM) or 'utc' (ISO string)",
    "local"
  )
  .option("--plugin-react-scan", "Enable react-scan performance monitoring for React applications")
  .option(
    "--disable-mcp-configs <targets>",
    "Comma or space separated list of MCP config files to skip (.mcp.json, .cursor/mcp.json, opencode.json). Use 'all' to disable all."
  )
  .option("--no-chrome-devtools-mcp", "Disable chrome-devtools MCP integration (enabled by default)")
  .option("--headless", "Run Chrome in headless mode (for serverless/CI environments)")
  .option("--kill-mcp", "Kill the MCP server on port 3684 and exit")
  .option(
    "--with-agent <command>",
    'Run an agent (e.g. claude) in split-screen mode using tmux. Example: --with-agent "claude"'
  )
  .action(async (options) => {
    // Load user config early so it can be used for --with-agent and agent selection flows
    const userConfig = loadUserConfig()

    // Apply browser default from user config if not explicitly provided via CLI
    const browserOption = options.browser || userConfig.browser

    // Handle --with-agent by spawning tmux with split panes
    if (options.withAgent) {
      await launchWithTmux(options.withAgent, parseInt(options.portMcp, 10), {
        port: options.port,
        portMcp: options.portMcp,
        script: options.script,
        command: options.command,
        profileDir: options.profileDir,
        browser: browserOption,
        serversOnly: options.serversOnly,
        headless: options.headless,
        dateTime: options.dateTime,
        pluginReactScan: options.pluginReactScan,
        disableMcpConfigs: options.disableMcpConfigs,
        chromeDevtoolsMcp: options.chromeDevtoolsMcp
      })
      return
    }
    // Handle --kill-mcp option
    if (options.killMcp) {
      console.log(chalk.yellow("🛑 Killing MCP server on port 3684..."))
      try {
        const { spawn } = require("child_process")
        await new Promise<void>((resolve) => {
          const killProcess = spawn("sh", ["-c", "lsof -ti:3684 | xargs kill -9"], { stdio: "inherit" })
          killProcess.on("exit", () => resolve())
        })
        console.log(chalk.green("✅ MCP server killed"))
      } catch (_error) {
        console.log(chalk.gray("⚠️ No MCP server found on port 3684"))
      }
      process.exit(0)
    }

    // Handle agent selection for split-screen mode (default behavior in TTY)
    // Skip if --no-tui, --debug flags are used, or if already inside tmux (to avoid nested prompts)
    const insideTmux = !!process.env.TMUX
    if (process.stdin.isTTY && !options.noTui && !options.debug && !insideTmux) {
      // Clear the terminal so d3k UI starts at the top of the screen
      process.stdout.write("\x1B[2J\x1B[0f")

      // Show loading message while checking for skills
      process.stdout.write(chalk.gray(" Checking for skill updates...\r"))

      // Check for new/updated skills from vercel-labs/agent-skills
      try {
        const newSkills = await checkForNewSkills()

        // Clear the loading message
        process.stdout.write("\x1B[2J\x1B[0f")

        if (newSkills.length > 0) {
          const selected = await promptSkillSelection(newSkills)
          if (selected.length > 0) {
            console.log(chalk.cyan(`Installing ${selected.length} skill(s)...`))
            const result = await installSelectedSkills(selected, (skill, index, total) => {
              console.log(chalk.gray(`  [${index + 1}/${total}] ${skill.name}...`))
            })
            if (result.success.length > 0) {
              console.log(chalk.green(`✓ Installed: ${result.success.join(", ")}`))
            }
            if (result.failed.length > 0) {
              console.log(chalk.yellow(`⚠ Failed: ${result.failed.join(", ")}`))
            }
            console.log("")
          }
        }
      } catch {
        // Clear and continue silently on errors (network issues, etc.)
        process.stdout.write("\x1B[2J\x1B[0f")
      }

      // Check if tmux is available before showing prompt
      if (!(await isTmuxInstalled())) {
        console.warn(chalk.yellow("⚠️ tmux not installed - agent split-screen mode unavailable"))
        console.warn(chalk.gray("  Install tmux to enable: brew install tmux (macOS)"))
        // Continue with normal startup
      } else {
        // Always show prompt, pre-selecting the last-used option
        const selectedAgent = await promptAgentSelection(userConfig.defaultAgent?.name)

        if (selectedAgent) {
          if (selectedAgent.name === "debug") {
            // User chose debug mode - enable debug and continue with normal startup
            options.debug = true
          } else {
            // User selected an agent - launch with tmux
            if (options.debug) {
              console.log(`[DEBUG] Launching tmux with agent command: ${selectedAgent.command}`)
            }
            // Clear screen and scrollback before launching tmux so when tmux exits, terminal is clean
            process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
            await launchWithTmux(selectedAgent.command, parseInt(options.portMcp, 10), {
              port: options.port,
              portMcp: options.portMcp,
              script: options.script,
              command: options.command,
              profileDir: options.profileDir,
              browser: browserOption,
              serversOnly: options.serversOnly,
              headless: options.headless,
              dateTime: options.dateTime,
              pluginReactScan: options.pluginReactScan,
              disableMcpConfigs: options.disableMcpConfigs,
              chromeDevtoolsMcp: options.chromeDevtoolsMcp
            })
            return
          }
        } else if (options.debug) {
          console.log("[DEBUG] No agent selected, continuing with normal startup")
        }
        // User chose "No agent" or "debug" - continue with normal startup
      }
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
    const userSetMcpPort = process.argv.includes("--port-mcp") || process.argv.includes("-p-mcp")
    const disableMcpConfigsInput =
      options.disableMcpConfigs ?? process.env.DEV3000_DISABLE_MCP_CONFIGS ?? userConfig.disableMcpConfigs
    const disabledMcpConfigs = parseDisabledMcpConfigs(disableMcpConfigsInput)

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
      console.log(
        `[DEBUG] Disabled MCP configs: ${
          disabledMcpConfigs.length ? formatMcpConfigTargets(disabledMcpConfigs) : "none"
        }`
      )
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
        portMcp: options.portMcp,
        debugPort: Number.parseInt(debugPort, 10),
        defaultPort: projectConfig.defaultPort,
        framework: projectConfig.framework,
        userSetPort,
        userSetMcpPort,
        logFile,
        profileDir,
        serverCommand,
        debug: options.debug,
        serversOnly: options.serversOnly,
        commandName,
        tail: options.tail,
        tui: options.noTui !== true && !options.debug, // TUI is default unless --no-tui or --debug is specified
        dateTimeFormat: options.dateTime || "local",
        pluginReactScan: options.pluginReactScan || false,
        chromeDevtoolsMcp: options.chromeDevtoolsMcp !== false, // Default to true unless explicitly disabled
        disabledMcpConfigs
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
  .description("Analyze and fix issues in current project using Vercel Sandbox + MCP tools")
  .option("--repo <url>", "Repository URL (e.g. https://github.com/user/repo)")
  .option("--branch <name>", "Git branch to test")
  .option("--project-dir <dir>", "Project directory within repo (e.g. 'www')")
  .option("--debug", "Enable debug logging")
  .option("--timeout <duration>", "Sandbox timeout (e.g. '30m', '1h')", "30m")
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
          console.log(chalk.gray("  • .claude/skills/ (project-local)"))
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

program.parse()

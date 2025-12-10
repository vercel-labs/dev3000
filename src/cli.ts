#!/usr/bin/env -S node --no-warnings

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
import { detectAIAgent } from "./utils/agent-detection.js"
import { formatMcpConfigTargets, parseDisabledMcpConfigs } from "./utils/mcp-configs.js"
import { getProjectName } from "./utils/project-name.js"
import { loadUserConfig } from "./utils/user-config.js"
import { checkForUpdates, getUpgradeCommand, performUpgrade } from "./utils/version-check.js"

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

// Read version from package.json
function getVersion(): string {
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
  .action(async (options) => {
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

    // Detect project type and configuration
    const projectConfig = await detectProjectType(options.debug)
    const userConfig = loadUserConfig()

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
      // Use -- to pass arguments through npm/pnpm/yarn to the underlying command
      if (userSetPort) {
        serverCommand += ` -- --port ${port}`
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

      // Get unique project name to create profile dir
      const projectName = getProjectName()
      const profileDir = join(homedir(), ".d3k", "chrome-profiles", projectName)

      // Find available Chrome debug port (starting from 9222)
      // Each d3k instance needs its own debug port to avoid conflicts
      const debugPort = await findAvailablePort(9222)

      await startDevEnvironment({
        ...options,
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

program.parse()

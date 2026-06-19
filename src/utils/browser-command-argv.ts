type BrowserCommand = "agent-browser"

const AGENT_BROWSER_OPTIONS_WITH_VALUES = new Set([
  "-d",
  "-p",
  "-s",
  "--action-policy",
  "--allowed-domains",
  "--args",
  "--cdp",
  "--color-scheme",
  "--config",
  "--confirm-actions",
  "--device",
  "--download-path",
  "--engine",
  "--executable-path",
  "--extension",
  "--headers",
  "--max-output",
  "--profile",
  "--profile-dir",
  "--provider",
  "--proxy",
  "--proxy-bypass",
  "--screenshot-dir",
  "--screenshot-format",
  "--screenshot-quality",
  "--selector",
  "--session",
  "--session-name",
  "--state",
  "--user-agent"
])

const AGENT_BROWSER_BOOLEAN_OPTIONS = new Set([
  "-c",
  "-i",
  "--allow-file-access",
  "--annotate",
  "--auto-connect",
  "--compact",
  "--confirm-interactive",
  "--content-boundaries",
  "--debug",
  "--headed",
  "--ignore-https-errors",
  "--interactive",
  "--json",
  "--no-auto-dialog",
  "--version"
])

const AGENT_BROWSER_OPEN_COMMANDS = new Set(["open", "goto", "navigate"])

const D3K_AGENT_BROWSER_WRAPPER_FLAGS = new Set(["--allow-new-browser", "--require-d3k-browser"])

const ROOT_OPTIONS_WITH_VALUES = new Set([
  "-p",
  "--port",
  "-s",
  "--script",
  "-c",
  "--command",
  "--startup-timeout",
  "--profile-dir",
  "--browser-tool",
  "--browser",
  "--date-time",
  "--with-agent",
  "--agent-name"
])

export interface BrowserCommandInvocation {
  browserCommand: BrowserCommand
  args: string[]
}

export interface AgentBrowserInvocation {
  args: string[]
  subcommand: string | null
  allowNewBrowser: boolean
  requireD3kBrowser: boolean
}

export function getBrowserCommandInvocation(argv: string[]): BrowserCommandInvocation | null {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]

    if (arg === "--") {
      return null
    }

    if (arg.startsWith("-")) {
      if (arg.includes("=")) {
        continue
      }
      if (ROOT_OPTIONS_WITH_VALUES.has(arg)) {
        index++
      }
      continue
    }

    if (arg === "agent-browser") {
      return {
        browserCommand: arg,
        args: argv.slice(index + 1)
      }
    }

    return null
  }

  return null
}

export function parseAgentBrowserInvocationArgs(args: string[]): AgentBrowserInvocation {
  let allowNewBrowser = false
  let requireD3kBrowser = false
  const cleanedArgs: string[] = []

  for (const arg of args) {
    if (arg === "--allow-new-browser") {
      allowNewBrowser = true
      continue
    }
    if (arg === "--require-d3k-browser") {
      requireD3kBrowser = true
      continue
    }
    cleanedArgs.push(arg)
  }

  return {
    args: cleanedArgs,
    subcommand: getAgentBrowserSubcommand(cleanedArgs),
    allowNewBrowser,
    requireD3kBrowser
  }
}

export function getAgentBrowserSubcommand(args: string[]): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === "--") {
      continue
    }

    if (arg.startsWith("-")) {
      if (arg.includes("=")) {
        continue
      }
      if (AGENT_BROWSER_OPTIONS_WITH_VALUES.has(arg)) {
        index++
        continue
      }
      if (AGENT_BROWSER_BOOLEAN_OPTIONS.has(arg) && isBooleanOptionValue(args[index + 1])) {
        index++
      }
      continue
    }

    return arg
  }

  return null
}

export function isAgentBrowserOpenCommand(subcommand: string | null): boolean {
  return subcommand !== null && AGENT_BROWSER_OPEN_COMMANDS.has(subcommand)
}

export function hasAgentBrowserOption(args: string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`))
}

export function hasD3kAgentBrowserWrapperFlag(args: string[]): boolean {
  return args.some((arg) => D3K_AGENT_BROWSER_WRAPPER_FLAGS.has(arg))
}

function isBooleanOptionValue(value: string | undefined): boolean {
  return value === "true" || value === "false"
}

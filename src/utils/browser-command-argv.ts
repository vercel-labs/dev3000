type BrowserCommand = "agent-browser"

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

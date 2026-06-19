import { describe, expect, it } from "vitest"
import {
  getAgentBrowserSubcommand,
  getBrowserCommandInvocation,
  hasAgentBrowserOption,
  isAgentBrowserOpenCommand,
  parseAgentBrowserInvocationArgs
} from "./browser-command-argv.js"

describe("getBrowserCommandInvocation", () => {
  it("detects direct agent-browser subcommands", () => {
    expect(getBrowserCommandInvocation(["agent-browser", "open", "http://localhost:3000"])).toEqual({
      browserCommand: "agent-browser",
      args: ["open", "http://localhost:3000"]
    })
  })

  it("detects agent-browser subcommands after root boolean flags", () => {
    expect(
      getBrowserCommandInvocation(["--debug", "--headless", "agent-browser", "open", "http://localhost:3000"])
    ).toEqual({
      browserCommand: "agent-browser",
      args: ["open", "http://localhost:3000"]
    })
  })

  it("ignores browser-tool option values", () => {
    expect(getBrowserCommandInvocation(["--browser-tool", "agent-browser", "--date-time", "local"])).toBeNull()
  })

  it("ignores non-browser root subcommands", () => {
    expect(getBrowserCommandInvocation(["logs", "--type", "browser"])).toBeNull()
  })

  it("ignores option values that happen to contain browser paths", () => {
    expect(
      getBrowserCommandInvocation([
        "--browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "--date-time",
        "local"
      ])
    ).toBeNull()
  })
})

describe("agent-browser invocation parsing", () => {
  it("detects direct open commands", () => {
    expect(getAgentBrowserSubcommand(["open", "http://localhost:3000"])).toBe("open")
    expect(isAgentBrowserOpenCommand("open")).toBe(true)
  })

  it("detects open after leading agent-browser options with values", () => {
    expect(
      getAgentBrowserSubcommand(["--profile", "/tmp/d3k-fresh-profile", "--headed", "open", "http://localhost:3000"])
    ).toBe("open")
  })

  it("handles boolean option values before the subcommand", () => {
    expect(getAgentBrowserSubcommand(["--headed", "false", "open", "http://localhost:3000"])).toBe("open")
  })

  it("recognizes open aliases as browser-opening commands", () => {
    expect(isAgentBrowserOpenCommand("goto")).toBe(true)
    expect(isAgentBrowserOpenCommand("navigate")).toBe(true)
    expect(isAgentBrowserOpenCommand("snapshot")).toBe(false)
  })

  it("strips d3k wrapper-only flags before invoking agent-browser", () => {
    expect(parseAgentBrowserInvocationArgs(["--require-d3k-browser", "open", "http://localhost:3000"])).toEqual({
      args: ["open", "http://localhost:3000"],
      subcommand: "open",
      allowNewBrowser: false,
      requireD3kBrowser: true
    })

    expect(parseAgentBrowserInvocationArgs(["open", "http://localhost:3000", "--allow-new-browser"])).toEqual({
      args: ["open", "http://localhost:3000"],
      subcommand: "open",
      allowNewBrowser: true,
      requireD3kBrowser: false
    })
  })

  it("detects options passed with separate or equals values", () => {
    expect(hasAgentBrowserOption(["--cdp", "9222", "open", "http://localhost:3000"], "--cdp")).toBe(true)
    expect(hasAgentBrowserOption(["--profile=/tmp/profile", "open", "http://localhost:3000"], "--profile")).toBe(true)
  })
})

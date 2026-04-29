import { describe, expect, it } from "vitest"
import { getBrowserCommandInvocation } from "./browser-command-argv.js"

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

import { describe, expect, it } from "vitest"
import {
  validateDateTimeOption,
  validatePortOption,
  validatePositiveIntegerOption,
  validateScriptOption
} from "./cli-options.js"

describe("cli option validation", () => {
  it("normalizes valid ports", () => {
    expect(validatePortOption("03000")).toBe("3000")
  })

  it("rejects invalid ports", () => {
    expect(() => validatePortOption("3000;touch /tmp/pwn")).toThrow("--port must be a numeric port number.")
    expect(() => validatePortOption("0")).toThrow("--port must be between 1 and 65535.")
    expect(() => validatePortOption("65536")).toThrow("--port must be between 1 and 65535.")
  })

  it("allows script names and file paths without shell metacharacters", () => {
    expect(validateScriptOption("dev")).toBe("dev")
    expect(validateScriptOption("dev:next")).toBe("dev:next")
    expect(validateScriptOption("scripts/dev-server.ts")).toBe("scripts/dev-server.ts")
  })

  it("rejects scripts that could be interpreted as flags", () => {
    expect(() => validateScriptOption("--inspect")).toThrow("cannot start with a hyphen")
    expect(() => validateScriptOption("-p")).toThrow("cannot start with a hyphen")
  })

  it("rejects scripts with shell metacharacters", () => {
    expect(() => validateScriptOption("dev;touch /tmp/pwn")).toThrow("--script may only contain")
    expect(() => validateScriptOption("$(touch /tmp/pwn)")).toThrow("--script may only contain")
  })

  it("validates positive integer options", () => {
    expect(validatePositiveIntegerOption("--startup-timeout", "30")).toBe("30")
    expect(() => validatePositiveIntegerOption("--startup-timeout", "0")).toThrow("must be a positive integer")
  })

  it("validates date time options", () => {
    expect(validateDateTimeOption("local")).toBe("local")
    expect(validateDateTimeOption("utc")).toBe("utc")
    expect(() => validateDateTimeOption("system")).toThrow("--date-time must be either")
  })
})

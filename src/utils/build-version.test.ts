import { describe, expect, it } from "vitest"

import { formatBuildVersion } from "./build-version.js"

describe("formatBuildVersion", () => {
  it("leaves stable versions unchanged", () => {
    expect(formatBuildVersion("1.2.3", "20260310T040506Z")).toBe("1.2.3")
  })

  it("leaves canary versions unchanged when no build stamp is provided", () => {
    expect(formatBuildVersion("0.0.171-canary")).toBe("0.0.171-canary")
  })

  it("appends the build stamp to canary versions", () => {
    expect(formatBuildVersion("0.0.171-canary", "20260310T040506Z")).toBe("0.0.171-canary+20260310T040506Z")
  })
})

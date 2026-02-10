import { describe, expect, it } from "vitest"
import { isValidRepoArg } from "./repo-validate.js"

describe("isValidRepoArg", () => {
  it("accepts owner/name", () => {
    expect(isValidRepoArg("vercel/dev3000")).toBe(true)
  })

  it("accepts GitHub URLs", () => {
    expect(isValidRepoArg("https://github.com/vercel/dev3000")).toBe(true)
    expect(isValidRepoArg("https://github.com/vercel/dev3000.git")).toBe(true)
    expect(isValidRepoArg("https://github.com/vercel/dev3000/")).toBe(true)
  })

  it("rejects empty or invalid values", () => {
    expect(isValidRepoArg("")).toBe(false)
    expect(isValidRepoArg(" ")).toBe(false)
    expect(isValidRepoArg("not a repo")).toBe(false)
    expect(isValidRepoArg("github.com/vercel/dev3000")).toBe(false)
    expect(isValidRepoArg("https://example.com/vercel/dev3000")).toBe(false)
  })
})

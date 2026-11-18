import { describe, expect, it, vi } from "vitest"
import { sandboxDevelopmentEnv } from "./sandbox-env.js"

const project = { id: "prj_example", accountId: "team_example" }

describe("sandbox environment preflight", () => {
  it("keeps app settings while excluding management credentials and non-string values", async () => {
    const run = vi.fn(async () =>
      JSON.stringify({
        env: {
          APP_KEY: "app",
          VERCEL_TOKEN: "secret",
          VERCEL_OIDC_TOKEN: "secret",
          VERCEL_AUTH_TOKEN: "secret",
          invalid: 123
        }
      })
    )
    expect(await sandboxDevelopmentEnv(project, "/tmp/control", run)).toEqual({ APP_KEY: "app" })
    expect(run).toHaveBeenCalledWith(
      "vercel",
      ["api", "/v3/env/pull/prj_example/development", "--scope", "team_example", "--raw"],
      { cwd: "/tmp/control" }
    )
  })

  it("reports a scoped fresh-authentication command without retrying or writing env files", async () => {
    const run = vi.fn(async () => {
      throw new Error("Challenge required (403)")
    })
    await expect(sandboxDevelopmentEnv(project, "/tmp/control", run)).rejects.toThrow(
      "vercel env pull /dev/null --project prj_example --scope team_example"
    )
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("does not treat other access failures as authentication challenges", async () => {
    const run = vi.fn(async () => {
      throw new Error("Access denied")
    })
    await expect(sandboxDevelopmentEnv(project, "/tmp/control", run)).rejects.toThrow("Access denied")
  })
})

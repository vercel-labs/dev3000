import { Command } from "commander"
import { describe, expect, it } from "vitest"
import { addSandboxProjectOptions, registerSandboxCommand, resolveSandboxOptions } from "./sandbox-command.js"

describe("sandbox project selection", () => {
  it("resolves team/project without using a local checkout's team", () => {
    expect(resolveSandboxOptions({ project: "elsigh-pro/cranio-mom" })).toMatchObject({
      scope: "elsigh-pro",
      project: "cranio-mom"
    })
    expect(resolveSandboxOptions({ project: "prj_example", scope: "team_example" })).toMatchObject({
      project: "prj_example",
      scope: "team_example"
    })
  })

  it.each(["/project", "team/", "team/project/extra", ""])("rejects ambiguous project %s", (project) => {
    expect(() => resolveSandboxOptions({ project })).toThrow()
  })

  it("rejects conflicting team selectors and invalid lifecycle options before provisioning", () => {
    expect(() => resolveSandboxOptions({ project: "team/project", scope: "other" })).toThrow("conflicts")
    expect(() => resolveSandboxOptions({ project: "project", timeout: "NaN" })).toThrow("timeout")
    expect(() => resolveSandboxOptions({ project: "project", attach: "existing", branch: "main" })).toThrow("--attach")
  })

  it("accepts a stable hostname and rejects names outside one lowercase DNS label", () => {
    expect(resolveSandboxOptions({ project: "team/songbook-studio", hostname: "songbook" }).hostname).toBe("songbook")
    for (const hostname of ["Songbook", "songbook.d3k", "-songbook", "songbook-", "a".repeat(64)])
      expect(() => resolveSandboxOptions({ project: "team/songbook-studio", hostname })).toThrow("--hostname")
  })

  it.each(["0", "NaN", "Infinity", "-1"])("rejects invalid Gateway budget %s before provisioning", (gatewayBudget) => {
    expect(() => resolveSandboxOptions({ project: "team/project", gatewayBudget })).toThrow("--gateway-budget")
  })

  it.each(["", "sandbox"])("parses the same shell/fx defaults for prefix %j", async (subcommand) => {
    const prefix = subcommand ? [subcommand] : []
    const program = new Command().exitOverride()
    registerSandboxCommand(program)
    addSandboxProjectOptions(program).option("--command <command>").option("--headless")
    const target = prefix.length ? program.commands[0] : program
    let result: unknown
    target.action((options) => {
      result = resolveSandboxOptions(options)
    })
    await program.parseAsync([...prefix, "--project", "elsigh-pro/cranio-mom", "--command", "bun run dev"], {
      from: "user"
    })
    expect(result).toMatchObject({
      project: "cranio-mom",
      scope: "elsigh-pro",
      timeout: "60",
      harnessLocation: "local",
      shell: true,
      fx: true,
      command: "bun run dev"
    })
    await program.parseAsync(
      [...prefix, "--project", "elsigh-pro/cranio-mom", "--no-shell", "--no-fx", "--timeout", "15"],
      {
        from: "user"
      }
    )
    expect(result).toMatchObject({ shell: false, fx: false, timeout: "15" })
  })

  it("accepts the explicit remote location and rejects arbitrary locations", () => {
    expect(
      resolveSandboxOptions({ project: "team/project", harness: "fx", harnessLocation: "sandbox" }).harnessLocation
    ).toBe("sandbox")
    expect(() => resolveSandboxOptions({ project: "team/project", harnessLocation: "somewhere" as "local" })).toThrow(
      "harness location"
    )
  })
})

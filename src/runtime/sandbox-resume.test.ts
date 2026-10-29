import { Command } from "commander"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { launchSandbox } from "./sandbox.js"
import { addSandboxProjectOptions, registerSandboxCommand, runSandboxProject } from "./sandbox-command.js"
import { listSandboxSessions, readSandboxSession, sandboxLauncherAlive } from "./sandbox-sessions.js"

vi.mock("./sandbox.js", () => ({ launchSandbox: vi.fn() }))
vi.mock("./sandbox-sessions.js", async (original) => ({
  ...(await original<typeof import("./sandbox-sessions.js")>()),
  listSandboxSessions: vi.fn(),
  readSandboxSession: vi.fn(),
  sandboxLauncherAlive: vi.fn()
}))
const record = {
  version: 1 as const,
  id: "04b39196-d4e2-4f3b-8ffc-7d3fdb067f6a",
  project: "prj_test",
  projectName: "songbook-studio",
  team: "team_test",
  scope: "elsigh-pro",
  sandbox: "my-sandbox",
  hostname: "songbook",
  appUrl: "https://songbook.d3k.localhost",
  workdir: "/vercel/songbook.studio",
  command: "bun run dev:next",
  timeout: "60",
  fx: false,
  ownsSandbox: false,
  createdAt: "2026-10-28T00:00:00.000Z",
  lastUsedAt: "2026-10-28T00:00:00.000Z"
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readSandboxSession).mockReturnValue(record)
  vi.mocked(listSandboxSessions).mockReturnValue([record])
  vi.mocked(sandboxLauncherAlive).mockReturnValue(false)
})
async function parse(args: string[]) {
  const program = new Command().exitOverride()
  registerSandboxCommand(program)
  addSandboxProjectOptions(program).option("--command <command>").option("--headless").action(runSandboxProject)
  await program.parseAsync(args, { from: "user" })
}
describe("sandbox resume CLI", () => {
  it.each([{ prefix: [] }, { prefix: ["sandbox"] }])(
    "lists sessions without launching infrastructure for prefix %j",
    async ({ prefix }) => {
      const output = vi.spyOn(console, "log").mockImplementation(() => {})
      try {
        await parse([...prefix, "--resume"])
        expect(output).toHaveBeenCalledWith(expect.stringContaining(record.id))
        expect(launchSandbox).not.toHaveBeenCalled()
      } finally {
        output.mockRestore()
      }
    }
  )
  it("restores project, hostname and command and retains saved fx/timeout preferences", async () => {
    await parse(["--resume", record.id])
    expect(launchSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: record.id,
        project: record.project,
        scope: record.team,
        attach: record.sandbox,
        hostname: "songbook",
        command: "bun run dev:next",
        fx: false,
        timeout: "60"
      })
    )
  })
  it("allows explicit command and lifecycle overrides", async () => {
    await parse(["sandbox", "--resume", record.id, "--no-shell", "--timeout", "45", "--command", "bun run dev"])
    expect(launchSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ shell: false, timeout: "45", command: "bun run dev" })
    )
  })
  it("rejects a running companion or conflicting project before provisioning", async () => {
    vi.mocked(sandboxLauncherAlive).mockReturnValue(true)
    await expect(parse(["--resume", record.id])).rejects.toThrow("running companion")
    await expect(parse(["--resume", record.id, "--project", "other"])).rejects.toThrow("omit --project")
    expect(launchSandbox).not.toHaveBeenCalled()
  })
})

import { join } from "node:path"
import { Script } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import { cloudBootstrap } from "../../www/lib/hosted/bootstrap.js"

describe("hosted browser bootstrap", () => {
  it.each([
    { recover: false, installed: false },
    { recover: true, installed: false },
    { recover: true, installed: true }
  ])("starts standard Chrome when recover=$recover and installed=$installed", async ({ recover, installed }) => {
    const commands: Array<{ command: string; args: string[] }> = []
    const states: string[] = []
    const removed: string[] = []
    const startRuntime = vi.fn(async () => {})
    const process = {
      env: { PATH: "/usr/bin" },
      chdir: vi.fn(),
      exitCode: 0,
      stdin: (async function* () {
        yield JSON.stringify({ recover, workdir: "/vercel/project", preview: { origin: "https://example.test" } })
      })()
    }
    // Run the actual uploaded program with only its host/VM effects replaced.
    const source = cloudBootstrap
      .replace(/^import .*;$/gm, "")
      .replace(
        "const {startRuntime}=await import('/tmp/d3k-tools/node_modules/dev3000/dist/runtime/runtime.js');",
        "const {startRuntime}=runtime;"
      )
    await new Script(`(async () => {${source}})()`).runInNewContext({
      process,
      path: { join },
      runtime: { startRuntime },
      fs: {
        existsSync: () => installed,
        writeFileSync: (_path: string, value: string) => states.push(JSON.parse(value).phase),
        unlinkSync: (path: string) => removed.push(path)
      },
      spawnSync: (command: string, args: string[]) => {
        commands.push({ command, args })
        return { status: 0 }
      }
    })
    expect(process.exitCode).toBe(0)
    expect(states.at(-1)).toBe("ready")
    expect(startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: "/opt/google/chrome/chrome",
        profileDir: "/tmp/d3k-cloud-chrome",
        headless: true
      })
    )
    expect(commands.filter(({ args }) => args[0] === "dnf")).toHaveLength(installed ? 0 : 1)
    if (!installed) {
      expect(commands).toContainEqual({
        command: "sudo",
        args: [
          "dnf",
          "install",
          "-y",
          "--setopt=localpkg_gpgcheck=1",
          "https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm"
        ]
      })
    }
    expect(removed).toEqual(
      recover
        ? [
            "/tmp/d3k-cloud-chrome/SingletonLock",
            "/tmp/d3k-cloud-chrome/SingletonSocket",
            "/tmp/d3k-cloud-chrome/SingletonCookie"
          ]
        : []
    )
  })
})

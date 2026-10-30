import { spawn } from "node:child_process"
import { once } from "node:events"
import { describe, expect, it } from "vitest"
import { runSandboxCli } from "./sandbox-process.js"

describe("sandbox CLI subprocess lifecycle", () => {
  it("times out a cleanup command that ignores graceful termination", async () => {
    await expect(
      runSandboxCli(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        isolated: true,
        timeoutMs: 200
      })
    ).rejects.toThrow("timed out")
  })

  it.skipIf(process.platform === "win32")(
    "keeps cleanup running when its terminal process group receives repeated Ctrl-C",
    async () => {
      // The fixture owns its own process group, so the test never signals the runner/user's terminal.
      const source = new URL("./sandbox-process.ts", import.meta.url).href
      const leader = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import { runSandboxCli } from ${JSON.stringify(source)};
      process.on('SIGINT', () => {});
      process.on('SIGUSR1', () => process.stdout.write('ready\\n'));
      const result = await runSandboxCli(process.execPath, ['-e',
        'process.kill(' + process.pid + ', "SIGUSR1"); setTimeout(() => process.stdout.write("revoked"), 500)'
      ], { isolated: true, timeoutMs: 3000 });
      process.stdout.write(result);
    `
        ],
        { detached: true, stdio: ["ignore", "pipe", "pipe"] }
      )
      const pid = leader.pid
      if (!pid) throw new Error("Could not start signal fixture")
      const exited = once(leader, "exit")
      let output = ""
      leader.stdout.on("data", (chunk) => {
        output += chunk.toString()
      })
      try {
        await once(leader.stdout, "data")
        process.kill(-pid, "SIGINT")
        process.kill(-pid, "SIGINT")
        expect((await exited)[0]).toBe(0)
        expect(output).toContain("revoked")
      } finally {
        if (leader.exitCode === null) process.kill(-pid, "SIGKILL")
      }
    }
  )
})

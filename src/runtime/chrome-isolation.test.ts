import { execFile, execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { isolatedChromeInvocation } from "./chrome-isolation.js"

describe.skipIf(process.platform !== "darwin")("Chrome filesystem confinement", () => {
  const installedChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  it.skipIf(!existsSync(installedChrome))(
    "starts installed Chrome under confinement with a dedicated profile",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "d3k-installed-chrome-test-"))
      const profile = join(directory, "profile")
      try {
        const invocation = isolatedChromeInvocation(
          installedChrome,
          [
            `--user-data-dir=${profile}`,
            "--headless=new",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-gpu",
            "--dump-dom",
            "data:text/html,<p>d3k-confined-chrome-ready</p>"
          ],
          profile
        )
        const { stdout } = await promisify(execFile)(invocation.binary, invocation.args, {
          env: invocation.env,
          timeout: 20000,
          maxBuffer: 1024 * 1024
        })
        expect(stdout).toContain("<p>d3k-confined-chrome-ready</p>")
        expect(invocation.args[1]).toContain("com.apple.pasteboard.1")
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
    30000
  )
  it("permits session files but denies unrelated files and symlink escapes for inherited child processes", () => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-isolation-test-"))
    const profile = join(directory, "profile")
    const secret = join(directory, "outside.txt")
    writeFileSync(secret, "not-for-the-browser")
    try {
      const bundle = join(directory, "Test.app", "Contents", "MacOS")
      mkdirSync(bundle, { recursive: true })
      const binary = join(bundle, "Chrome")
      writeFileSync(binary, "", { mode: 0o755 })
      const invocation = isolatedChromeInvocation(binary, [], profile)
      const policy = invocation.args[1]
      execFileSync("/usr/bin/sandbox-exec", [
        "-p",
        policy,
        "/bin/sh",
        "-c",
        'printf safe > "$1/inside"; cat "$1/inside"',
        "probe",
        profile
      ])
      const denied = spawnSync("/usr/bin/sandbox-exec", ["-p", policy, "/bin/cat", secret], { encoding: "utf8" })
      expect(denied.status).not.toBe(0)
      expect(denied.stdout).not.toContain("not-for-the-browser")
      execFileSync("ln", ["-s", secret, join(profile, "escape")])
      const escapedRead = spawnSync(
        "/usr/bin/sandbox-exec",
        ["-p", policy, "/bin/sh", "-c", 'cat "$1"', "probe", join(profile, "escape")],
        { encoding: "utf8" }
      )
      expect(escapedRead.status).not.toBe(0)
      expect(escapedRead.stdout).not.toContain("not-for-the-browser")
      const write = spawnSync("/usr/bin/sandbox-exec", [
        "-p",
        policy,
        "/bin/sh",
        "-c",
        'printf bad > "$1"',
        "probe",
        secret
      ])
      expect(write.status).not.toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it("blocks the host pasteboard service even when a native client can normally read it", () => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-pasteboard-test-"))
    try {
      const source = join(directory, "probe.swift")
      const binary = join(directory, "probe")
      const bundle = join(directory, "Probe.app")
      mkdirSync(bundle)
      const chrome = join(bundle, "Chrome")
      writeFileSync(chrome, "")
      const name = `d3k-test-${Date.now()}`
      writeFileSync(
        source,
        `import AppKit
let board = NSPasteboard(name: NSPasteboard.Name("${name}"))
if CommandLine.arguments.contains("home") { print(NSHomeDirectory()) }
else if CommandLine.arguments.contains("seed") { board.clearContents(); print(board.setString("test-sentinel",forType:.string)) }
else { print(board.string(forType:.string) == "test-sentinel") }`
      )
      execFileSync("/usr/bin/swiftc", [source, "-o", binary])
      expect(execFileSync(binary, ["seed"], { encoding: "utf8" }).trim()).toBe("true")
      expect(execFileSync(binary, [], { encoding: "utf8" }).trim()).toBe("true")
      const invocation = isolatedChromeInvocation(chrome, [], join(directory, "profile"))
      // Cocoa must resolve its home inside the isolated profile even before
      // Chrome has applied its --user-data-dir override.
      const home = execFileSync("/usr/bin/sandbox-exec", ["-p", invocation.args[1], binary, "home"], {
        env: invocation.env,
        encoding: "utf8"
      })
      expect(realpathSync(home.trim())).toBe(realpathSync(join(directory, "profile")))
      const confined = spawnSync("/usr/bin/sandbox-exec", ["-p", invocation.args[1], binary], {
        encoding: "utf8",
        timeout: 10000
      })
      expect(confined.status).toBe(0)
      expect(confined.stdout.trim()).toBe("false")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30000)
})

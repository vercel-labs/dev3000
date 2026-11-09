import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { dependencyCacheScript, dependencyInstallPlanScript, distributionFingerprint } from "./sandbox-setup"

const directories: string[] = []
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "d3k-setup-")))
  directories.push(root)
  execFileSync("git", ["init", "--quiet", root])
  writeFileSync(join(root, ".gitignore"), "node_modules/\nsetup.sha256\n")
  mkdirSync(join(root, "node_modules"))
  writeFileSync(join(root, "package.json"), '{"dependencies":{"example":"1"}}')
  const run = (mode: string, seed = "bun install") =>
    spawnSync(process.execPath, ["-e", dependencyCacheScript, mode, join(root, "setup.sha256"), seed], { cwd: root })
  return { root, run }
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("sandbox setup reuse", () => {
  it("resolves the install plan through the remote process entry point", () => {
    const { root } = fixture()
    writeFileSync(join(root, "package.json"), '{"packageManager":"npm@11.6.2"}')
    const cwd = join(root, "apps/web")
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(cwd, "package.json"), "{}")
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        dependencyInstallPlanScript,
        fileURLToPath(new URL("./package-manager.ts", import.meta.url)),
        root
      ],
      { cwd, encoding: "utf8" }
    )
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ command: "npm install", cwd: root })
  })

  it("reuses successful installs, but invalidates workspace edits, locks, settings and missing dependencies", () => {
    const { root, run } = fixture()
    expect(run("check").status).toBe(10)
    expect(run("save").status).toBe(0)
    expect(run("check").status).toBe(0)
    writeFileSync(join(root, "app.ts"), "// coding changes do not require installation")
    expect(run("check").status).toBe(0)
    mkdirSync(join(root, "packages", "child"), { recursive: true })
    writeFileSync(join(root, "packages", "child", "package.json"), '{"name":"child"}')
    expect(run("check").status).toBe(10)
    expect(run("save").status).toBe(0)
    writeFileSync(join(root, "bun.lock"), "changed lockfile")
    expect(run("check").status).toBe(10)
    expect(run("save").status).toBe(0)
    expect(run("check", "different command or environment").status).toBe(10)
    rmSync(join(root, "node_modules"), { recursive: true })
    expect(run("check").status).toBe(10)
  })
  it("hashes actual runtime contents even when the package version is unchanged", () => {
    const { root } = fixture()
    for (const directory of ["bin", "dist", "scripts/eve", "skills/d3k"])
      mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(join(root, "dist", "cli.js"), "version one")
    const before = distributionFingerprint(root)
    expect(distributionFingerprint(root)).toBe(before)
    writeFileSync(join(root, "dist", "cli.js"), "version two")
    expect(distributionFingerprint(root)).not.toBe(before)
  })

  it("reuses Yarn PnP installs and invalidates Yarn settings and npm shrinkwrap changes", () => {
    const { root, run } = fixture()
    rmSync(join(root, "node_modules"), { recursive: true })
    writeFileSync(join(root, ".pnp.cjs"), "// Yarn loader")
    expect(run("save").status).toBe(0)
    expect(run("check").status).toBe(0)
    for (const name of [".yarnrc.yml", "npm-shrinkwrap.json"]) {
      writeFileSync(join(root, name), "changed install input")
      expect(run("check").status).toBe(10)
      expect(run("save").status).toBe(0)
    }
  })
})

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { dependencyInstallPlan, detectPackageManager } from "./package-manager.js"

const directories: string[] = []
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "d3k-manager-")))
  directories.push(root)
  const write = (name: string, contents = "") => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), contents)
  }
  write("package.json", "{}")
  for (const command of ["bun", "pnpm", "yarn", "npm", "corepack"]) {
    write(`bin/${command}`, "#!/bin/sh\nexit 0\n")
    chmodSync(join(root, "bin", command), 0o755)
  }
  vi.stubEnv("PATH", join(root, "bin"))
  return { root, write }
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("repository package manager", () => {
  it("installs from the declaring workspace root, even with a stale child lockfile", () => {
    const { root, write } = fixture()
    write("package.json", JSON.stringify({ packageManager: "pnpm@12.15.0" }))
    write("apps/web/package.json", '{"scripts":{"dev":"next dev"}}')
    write("apps/web/package-lock.json")
    const cwd = join(root, "apps/web")
    expect(dependencyInstallPlan(cwd, root)).toEqual({ command: "pnpm install", cwd: root })
    expect(detectPackageManager(cwd, root).manager).toBe("pnpm")
  })

  it.each([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["pnpm-workspace.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"]
  ])("uses %s to choose %s from a nested project", (marker, manager) => {
    const { root, write } = fixture()
    write(marker)
    write("apps/web/package.json", "{}")
    expect(dependencyInstallPlan(join(root, "apps/web"), root)).toEqual({ command: `${manager} install`, cwd: root })
  })

  it("honors a nearer packageManager declaration and both Bun lockfile formats together", () => {
    const { root, write } = fixture()
    write("package.json", '{"packageManager":"pnpm@12.15.0"}')
    write("independent/package.json", '{"packageManager":"yarn@4.9.0"}')
    expect(dependencyInstallPlan(join(root, "independent"), root)).toEqual({
      command: "yarn install",
      cwd: join(root, "independent")
    })
    write("independent/package.json", "{}")
    write("independent/bun.lock")
    write("independent/bun.lockb")
    expect(detectPackageManager(join(root, "independent"), join(root, "independent")).manager).toBe("bun")
  })

  it("rejects unsupported or ambiguous managers instead of silently installing with Bun", () => {
    const { root, write } = fixture()
    write("bun.lock")
    write("yarn.lock")
    expect(() => dependencyInstallPlan(root, root)).toThrow("Conflicting")
    write("package.json", '{"packageManager":"unrecognized@1.0.0"}')
    expect(() => dependencyInstallPlan(root, root)).toThrow("Unsupported")
    expect(dependencyInstallPlan(root, root, "custom install")).toEqual({ command: "custom install", cwd: root })
  })

  it("keeps explicit project/CLI install commands in the project directory", () => {
    const { root, write } = fixture()
    write("package.json", '{"packageManager":"pnpm@12.15.0"}')
    write("apps/web/package.json", "{}")
    const cwd = join(root, "apps/web")
    expect(dependencyInstallPlan(cwd, root, "pnpm install --offline")).toEqual({
      command: "pnpm install --offline",
      cwd
    })
  })

  it("uses Corepack when a selected pnpm or Yarn executable is absent, without rewriting overrides", () => {
    const { root, write } = fixture()
    for (const manager of ["pnpm", "yarn"]) {
      write("package.json", JSON.stringify({ packageManager: `${manager}@1.0.0` }))
      rmSync(join(root, "bin", manager))
      expect(dependencyInstallPlan(root, root)).toEqual({ command: `corepack ${manager} install`, cwd: root })
      expect(dependencyInstallPlan(root, root, `${manager} install --offline`)).toEqual({
        command: `${manager} install --offline`,
        cwd: root
      })
    }
  })

  it("stops at the checkout boundary and falls back to npm when no manager is identified", () => {
    const { root, write } = fixture()
    write("package.json", '{"packageManager":"bun@1.3.0"}')
    write("nested/package.json", "{}")
    const nested = join(root, "nested")
    expect(dependencyInstallPlan(nested, nested)).toEqual({ command: "npm install", cwd: nested })
    write("nested/.git", "gitdir: elsewhere")
    expect(detectPackageManager(nested)).toEqual({ manager: "npm", root: nested })
    expect(() => detectPackageManager(root, nested)).toThrow("escapes")
  })
})

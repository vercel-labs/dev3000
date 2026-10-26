import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("installed skill bootstrap", () => {
  it.each([0, 7])("isolates pnpm from the app workspace, forwards arguments and preserves exit code %i", (exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "d3k-bootstrap-test-"))
    try {
      const app = join(root, "app with spaces")
      const bin = join(root, "bin")
      mkdirSync(app)
      mkdirSync(bin)
      writeFileSync(join(app, "pnpm-workspace.yaml"), "allowBuilds: {}\n")
      const helper = join(root, "runtime.mjs")
      copyFileSync(resolve("skills/d3k/scripts/runtime.mjs"), helper)
      const report = join(root, "report.json")
      const pnpm = join(bin, "pnpm")
      writeFileSync(
        pnpm,
        `#!/usr/bin/env node
const fs = require('node:fs');
if (fs.existsSync('pnpm-workspace.yaml')) process.exit(99);
fs.writeFileSync(process.env.BOOTSTRAP_TEST_REPORT, JSON.stringify({
  acquisition: process.cwd(), target: process.env.D3K_BOOTSTRAP_CWD,
  corepack: process.env.COREPACK_ENABLE_PROJECT_SPEC, args: process.argv.slice(2)
}));
process.exit(${exitCode});
`
      )
      chmodSync(pnpm, 0o755)
      const result = spawnSync(process.execPath, [helper, "browser", "eval", "document.title + ' hello'"], {
        cwd: app,
        env: {
          ...process.env,
          D3K_RUNTIME_ROOT: root,
          PATH: `${bin}:${process.env.PATH}`,
          BOOTSTRAP_TEST_REPORT: report
        },
        encoding: "utf8"
      })
      expect(result.status, result.stderr).toBe(exitCode)
      const observed = JSON.parse(readFileSync(report, "utf8"))
      expect(observed.target).toBe(realpathSync(app))
      expect(observed.acquisition).not.toBe(app)
      expect(observed.corepack).toBe("0")
      expect(observed.args).toEqual([
        "--package=dev3000",
        "dlx",
        "d3k-runtime",
        "browser",
        "eval",
        "document.title + ' hello'"
      ])
      expect(existsSync(observed.acquisition)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

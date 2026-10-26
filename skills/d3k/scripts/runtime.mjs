#!/usr/bin/env node
// Runs the checkout during development, or the published JS entrypoint after installation.
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const checkout = process.env.D3K_RUNTIME_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const source = resolve(checkout, "src/runtime/cli.ts")
const built = resolve(checkout, "dist/runtime/cli.js")
const args = process.argv.slice(2)
const command = existsSync(source) ? "bun" : existsSync(built) ? process.execPath : "pnpm"
const prefix = existsSync(source) ? [source] : existsSync(built) ? [built] : ["--package=dev3000", "dlx", "d3k-runtime"]
// pnpm reads workspace configuration even for dlx. Acquire the package outside
// the app, then let the runtime restore the original project directory.
const bootstrap = command === "pnpm" ? mkdtempSync(resolve(tmpdir(), "d3k-bootstrap-")) : undefined
const cleanup = () => { if (bootstrap) rmSync(bootstrap, { recursive: true, force: true }) }
const child = spawn(command, [...prefix, ...args], {
  stdio: "inherit",
  cwd: bootstrap,
  env: bootstrap ? { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: "0", D3K_BOOTSTRAP_CWD: process.cwd() } : process.env
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
child.on("error", error => { cleanup(); console.error(error.message); process.exitCode = 1 })
child.on("exit", (code, signal) => { cleanup(); process.exitCode = code ?? (signal ? 1 : 0) })

#!/usr/bin/env node
// Runs the checkout during development, or the published JS entrypoint after installation.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const checkout = process.env.D3K_RUNTIME_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const source = resolve(checkout, "src/runtime/cli.ts")
const built = resolve(checkout, "dist/runtime/cli.js")
const args = process.argv.slice(2)
const command = existsSync(source) ? "bun" : existsSync(built) ? process.execPath : "bunx"
const prefix = existsSync(source) ? [source] : existsSync(built) ? [built] : ["--package", "dev3000", "d3k-runtime"]
const child = spawn(command, [...prefix, ...args], { stdio: "inherit" })
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
child.on("error", error => { console.error(error.message); process.exitCode = 1 })
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })

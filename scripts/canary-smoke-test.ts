#!/usr/bin/env bun

import { spawnSync } from "child_process"
import { existsSync } from "fs"
import { join } from "path"

const platform = process.platform
const arch = process.arch

const target =
  platform === "darwin" && arch === "arm64"
    ? "d3k-darwin-arm64"
    : platform === "linux" && arch === "x64"
      ? "d3k-linux-x64"
      : platform === "win32" && arch === "x64"
        ? "d3k-windows-x64"
        : null

if (!target) {
  console.error(`Unsupported platform for canary smoke test: ${platform}-${arch}`)
  process.exit(1)
}

const binaryName = platform === "win32" ? "dev3000.exe" : "dev3000"
const binaryPath = join(process.cwd(), "dist-bin", target, "bin", binaryName)

if (!existsSync(binaryPath)) {
  console.error(`Canary binary not found: ${binaryPath}`)
  console.error("Run `bun run canary` first.")
  process.exit(1)
}

const result = spawnSync(binaryPath, ["--version"], { encoding: "utf-8" })
if (result.status !== 0) {
  console.error("Canary binary failed to run:")
  if (result.stderr) console.error(result.stderr)
  process.exit(result.status ?? 1)
}

const output = (result.stdout || "").trim()
if (!output) {
  console.error("Canary binary returned empty version output")
  process.exit(1)
}

console.log(`✅ Canary binary ok: ${output}`)

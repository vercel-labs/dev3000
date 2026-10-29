#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

for (const [entry, args] of [
  ["d3k", ["--version"]],
  ["dev3000", ["--version"]],
  ["d3k-runtime", ["--help"]],
  ["d3k", ["start", "--help"]],
  ["dev3000", ["sandbox", "--help"]]
] as const) {
  const result = spawnSync(join(homedir(), ".bun", "bin", entry), args, { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`${entry} smoke test failed: ${result.stderr}`)
  console.log(`${entry}: ${result.stdout.split("\n")[0]}`)
}

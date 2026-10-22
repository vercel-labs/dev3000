#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { join } from "node:path"

for (const [entry, args] of [
  ["dev3000", ["--version"]],
  ["d3k-runtime", ["--help"]]
] as const) {
  const result = spawnSync("node", [join(process.cwd(), "bin", entry), ...args], { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`${entry} smoke test failed: ${result.stderr}`)
  console.log(`${entry}: ${result.stdout.split("\n")[0]}`)
}

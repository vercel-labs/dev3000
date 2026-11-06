import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { eveBuildCacheProbe, eveBuildFingerprint } from "./build-cache.mjs"

it("reuses completed Eve builds and invalidates changed sources, versions and missing artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "d3k-eve-cache-"))
  try {
    const files = [
      { path: "agent/agent.ts", content: Buffer.from("agent source") },
      { path: "package.json", content: Buffer.from('{"eve":"1"}') }
    ]
    const fingerprint = eveBuildFingerprint(files)
    expect(eveBuildFingerprint([...files].reverse())).toBe(fingerprint)
    const probe = (hash = fingerprint) =>
      spawnSync(process.execPath, ["-e", eveBuildCacheProbe, hash], { cwd: root }).status
    mkdirSync(join(root, "node_modules/eve/bin"), { recursive: true })
    mkdirSync(join(root, ".eve"))
    writeFileSync(join(root, "node_modules/eve/bin/eve.js"), "")
    expect(probe()).toBe(10)
    writeFileSync(join(root, ".d3k-build.sha256"), fingerprint)
    expect(probe()).toBe(0)
    expect(probe(eveBuildFingerprint([{ ...files[0], content: Buffer.from("updated agent") }, files[1]]))).toBe(10)
    expect(probe(eveBuildFingerprint([files[0], { ...files[1], content: Buffer.from('{"eve":"2"}') }]))).toBe(10)
    rmSync(join(root, ".eve"), { recursive: true })
    expect(probe()).toBe(10)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

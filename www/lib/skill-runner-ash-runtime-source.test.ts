import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const wwwRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const stepsSource = readFileSync(path.join(wwwRoot, "app/api/cloud/fix-workflow/steps.ts"), "utf8")

describe("packaged ASH runtime source", () => {
  it("installs generated ASH app dependencies without release-age filtering", () => {
    expect(stepsSource).toContain('"$BUN_BIN" install --silent --minimum-release-age=0')
  })

  it("starts generated ASH apps with the ASH start command", () => {
    expect(stepsSource).toContain('"$NODE_RUNTIME" ./node_modules/.bin/ash start')
    expect(stepsSource).not.toContain('"$NODE_RUNTIME" ./.output/server/index.mjs')
  })
})

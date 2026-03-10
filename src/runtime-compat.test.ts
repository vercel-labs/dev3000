import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { describe, expect, it } from "vitest"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readSourceFile(filename: string): string {
  return readFileSync(join(__dirname, filename), "utf-8")
}

describe("runtime compatibility", () => {
  it("loads OpenTUI only when running under Bun on macOS", () => {
    const fileContent = readSourceFile("tui-interface.ts")

    expect(fileContent).toContain('process.platform === "darwin" && Boolean(process.versions?.bun)')
    expect(fileContent).toContain('await import("./tui-interface-opentui.js")')
    expect(fileContent).toContain('await import("./tui-interface-impl.js")')
  })

  it("keeps the Node ESM entrypoints free of raw require calls", () => {
    const cliContent = readSourceFile("cli.ts")
    const devEnvironmentContent = readSourceFile("dev-environment.ts")

    expect(cliContent).not.toContain("require(")
    expect(devEnvironmentContent).not.toContain("require(")
  })
})

import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { expect, it } from "vitest"
import { updateChangelogPage } from "./update-changelog.js"

it.each([false, true])(
  "round-trips release text through generated TypeScript and Markdown (existing=%s)",
  async (existing) => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-changelog-"))
    const file = join(directory, "www/lib/changelog.ts")
    const previous = { version: "0.0.1", date: "2025-01-01", type: "patch", highlights: ["Earlier [entry]"] }
    const highlights = [
      'A backslash followed by a quote: \\"',
      "Windows path: C:\\temp\\new\\file.ts",
      "Replacement markers stay literal: $& $1 $$ $` $'",
      "Controls: tab\tnewline\ncarriage return\r and Unicode \u2028 \u2029"
    ]
    try {
      mkdirSync(join(directory, "www/lib"), { recursive: true })
      writeFileSync(
        file,
        `type Release = {version:string;date:string;type:string;highlights:string[]};\nexport const changelog: Release[] = ${JSON.stringify(existing ? [previous] : [])}\n`
      )
      updateChangelogPage("v0.0.2", highlights, "patch", file)
      const { stdout } = await promisify(execFile)("bun", [
        "-e",
        `import {changelog} from ${JSON.stringify(pathToFileURL(file).href)}; console.log(JSON.stringify(changelog));`
      ])
      const entries = JSON.parse(stdout)
      expect(entries[0]).toMatchObject({ version: "0.0.2", type: "patch", highlights })
      expect(entries.slice(1)).toEqual(existing ? [previous] : [])
      const source = readFileSync(file, "utf8")
      updateChangelogPage("v0.0.2", highlights, "patch", file)
      expect(readFileSync(file, "utf8")).toBe(source)
      await promisify(execFile)("bun", [fileURLToPath(new URL("./generate-changelog-md.ts", import.meta.url))], {
        cwd: directory
      })
      const markdown = readFileSync(join(directory, "CHANGELOG.md"), "utf8")
      for (const highlight of highlights) expect(markdown).toContain(`- ${highlight}`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

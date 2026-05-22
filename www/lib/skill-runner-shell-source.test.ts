import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isRunnerShellFile,
  resolveSkillRunnerShellSourceFromTree,
  type SkillRunnerShellTreeEntry,
  uploadSkillRunnerShellSourceFiles
} from "./skill-runner-shell-source"

const wwwRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(wwwRoot, "..")
const sourceExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]
const importedAssetExtensions = [".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"]
const relativeImportPattern =
  /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g

function listTrackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  })
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
}

function toTree(files: string[]): SkillRunnerShellTreeEntry[] {
  return files.map((file) => ({
    path: file,
    type: "blob"
  }))
}

function resolveLocalPath(repoRelativeFile: string): string {
  return path.join(repoRoot, repoRelativeFile)
}

function resolveImportedFile(importer: string, specifier: string, trackedFiles: Set<string>): string | undefined {
  const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
  const candidates = [
    ...sourceExtensions.map((extension) => `${basePath}${extension}`),
    ...importedAssetExtensions.map((extension) => `${basePath}${extension}`),
    ...sourceExtensions.filter(Boolean).map((extension) => `${basePath}/index${extension}`)
  ]

  return candidates.find((candidate) => trackedFiles.has(candidate))
}

function listRelativeImports(file: string): string[] {
  const content = readFileSync(resolveLocalPath(file), "utf8")
  const imports: string[] = []
  for (const match of content.matchAll(relativeImportPattern)) {
    const specifier = match[1] || match[2]
    if (specifier) imports.push(specifier)
  }
  return imports
}

describe("skill runner shell source manifest", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("includes public assets used by the deployable shell", () => {
    expect(isRunnerShellFile("www/public/hero-app.png")).toBe(true)
    expect(isRunnerShellFile("www/public/hero-terminal.png")).toBe(true)
    expect(isRunnerShellFile("www/.env.local")).toBe(false)
    expect(isRunnerShellFile("www/.next/server/app/page.js")).toBe(false)
  })

  it("includes tracked files reached by relative imports from included source files", () => {
    const trackedFiles = listTrackedFiles()
    const trackedFileSet = new Set(trackedFiles)
    const shellSource = resolveSkillRunnerShellSourceFromTree(toTree(trackedFiles), "test-commit")
    const shellFiles = new Set(shellSource.files.map((file) => file.path))
    const missingImports: string[] = []

    for (const file of shellFiles) {
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue
      if (!existsSync(resolveLocalPath(file))) continue

      for (const specifier of listRelativeImports(file)) {
        const importedFile = resolveImportedFile(file, specifier, trackedFileSet)
        if (importedFile && !shellFiles.has(importedFile)) {
          missingImports.push(`${file} imports ${specifier} -> ${importedFile}`)
        }
      }
    }

    expect(missingImports).toEqual([])
  })

  it("keeps the homepage hero assets in the runner deployment source", () => {
    const shellSource = resolveSkillRunnerShellSourceFromTree(toTree(listTrackedFiles()), "test-commit")
    const shellFiles = new Set(shellSource.files.map((file) => file.path))

    expect(shellFiles).toContain("www/app/page.tsx")
    expect(shellFiles).toContain("www/public/hero-app.png")
    expect(shellFiles).toContain("www/public/hero-terminal.png")
  })

  it("patches uploaded runner next config to avoid Preview Comments adapter skew", async () => {
    const uploadedBodies: string[] = []
    const nextConfig = 'import { withWorkflow } from "workflow/next"\n\nexport default withWorkflow({})\n'

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url === "https://example.test/www/next.config.ts") {
          return new Response(nextConfig)
        }

        if (url.startsWith("https://api.vercel.com/v2/files")) {
          uploadedBodies.push(new TextDecoder().decode(init?.body as ArrayBuffer))
          return new Response(null, { status: 200 })
        }

        return new Response("unexpected URL", { status: 500 })
      })
    )

    await uploadSkillRunnerShellSourceFiles({
      accessToken: "test-token",
      source: {
        commit: "test-commit",
        files: [
          {
            contentUrl: "https://example.test/www/next.config.ts",
            path: "www/next.config.ts"
          }
        ],
        version: "test-version"
      },
      teamId: "team_test"
    })

    expect(uploadedBodies).toHaveLength(1)
    expect(uploadedBodies[0]).toContain('process.env.VERCEL_PREVIEW_COMMENTS_ENABLED = "0"')
    expect(uploadedBodies[0]).toContain('import { withWorkflow } from "workflow/next"')
  })
})

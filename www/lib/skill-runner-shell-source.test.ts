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
const localImportPattern = /(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)["']((?:@\/|\.{1,2}\/)[^"']+)["']/g

function listTrackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
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
  const basePath = specifier.startsWith("@/")
    ? path.posix.normalize(`www/${specifier.slice(2)}`)
    : path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
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
  for (const match of content.matchAll(localImportPattern)) {
    const specifier = match[1]
    if (specifier) imports.push(specifier)
  }
  return imports
}

describe("skill runner shell source manifest", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("includes runner API and config files while excluding UI assets", () => {
    expect(isRunnerShellFile("package.json")).toBe(true)
    expect(isRunnerShellFile("bun.lock")).toBe(true)
    expect(isRunnerShellFile("www/package.json")).toBe(true)
    expect(isRunnerShellFile("www/app/api/cloud/start-fix/route.ts")).toBe(true)
    expect(isRunnerShellFile("www/app/api/cloud/fix-workflow/workflow.ts")).toBe(true)
    expect(isRunnerShellFile("www/app/api/skill-runner-worker/version/route.ts")).toBe(true)
    expect(isRunnerShellFile("www/app/skill-runner-worker-home.tsx")).toBe(true)
    expect(isRunnerShellFile("www/app/skill-runner-worker-layout.tsx")).toBe(true)
    expect(isRunnerShellFile("www/app/.well-known/workflow/v1/config.json")).toBe(true)
    expect(isRunnerShellFile("www/public/hero-app.png")).toBe(false)
    expect(isRunnerShellFile("www/public/hero-terminal.png")).toBe(false)
    expect(isRunnerShellFile("www/app/page.tsx")).toBe(false)
    expect(isRunnerShellFile("www/app/[team]/skill-runner/page.tsx")).toBe(false)
    expect(isRunnerShellFile("www/components/ui/button.tsx")).toBe(false)
    expect(isRunnerShellFile("www/lib/skill-runner-worker.test.ts")).toBe(false)
    expect(isRunnerShellFile("www/.env.local")).toBe(false)
    expect(isRunnerShellFile("www/.next/server/app/page.js")).toBe(false)
  })

  it("includes tracked files reached by local imports from included source files", () => {
    const trackedFiles = listTrackedFiles()
    const trackedFileSet = new Set(trackedFiles)
    const shellSource = resolveSkillRunnerShellSourceFromTree(toTree(trackedFiles), "test-commit")
    const shellFiles = new Set(shellSource.files.map((file) => file.path))
    const missingImports: string[] = []

    for (const file of shellSource.files) {
      const sourcePath = file.sourcePath || file.path
      if (!/\.[cm]?[jt]sx?$/.test(sourcePath)) continue
      if (!existsSync(resolveLocalPath(sourcePath))) continue

      for (const specifier of listRelativeImports(sourcePath)) {
        const importedFile = resolveImportedFile(sourcePath, specifier, trackedFileSet)
        if (importedFile && !shellFiles.has(importedFile)) {
          missingImports.push(`${sourcePath} imports ${specifier} -> ${importedFile}`)
        }
      }
    }

    expect(missingImports).toEqual([])
  })

  it("keeps the runner deployment source focused on worker files", () => {
    const shellSource = resolveSkillRunnerShellSourceFromTree(toTree(listTrackedFiles()), "test-commit")
    const shellFiles = new Set(shellSource.files.map((file) => file.path))

    expect(shellSource.files.length).toBeLessThanOrEqual(75)
    expect(shellFiles).toContain("www/app/api/cloud/start-fix/route.ts")
    expect(shellFiles).toContain("www/app/api/cloud/fix-workflow/workflow.ts")
    expect(shellFiles).toContain("www/app/api/cloud/fix-workflow/steps.ts")
    expect(shellFiles).toContain("www/app/api/skill-runner-worker/version/route.ts")
    expect(shellFiles).toContain("www/app/page.tsx")
    expect(shellFiles).toContain("www/app/layout.tsx")
    expect(shellFiles).not.toContain("www/app/skill-runner-worker-home.tsx")
    expect(shellFiles).not.toContain("www/app/skill-runner-worker-layout.tsx")
    expect(shellFiles).not.toContain("www/app/[team]/skill-runner/page.tsx")
    expect(shellFiles).not.toContain("www/public/hero-app.png")
    expect(shellFiles).not.toContain("www/public/hero-terminal.png")
    expect(shellFiles).not.toContain("www/components/ui/button.tsx")
  })

  it("patches uploaded runner manifests and next config", async () => {
    const uploadedBodies: string[] = []
    const rootPackageJson = JSON.stringify({
      dependencies: {
        chalk: "^5.0.0"
      },
      packageManager: "bun@1.2.5",
      version: "1.2.3",
      workspaces: ["www"]
    })
    const wwwPackageJson = JSON.stringify({
      dependencies: {
        "@radix-ui/react-dialog": "1.0.0",
        "@vercel/analytics": "latest",
        "@vercel/blob": "2.3.1",
        "@vercel/oidc": "3.2.0",
        "@vercel/sandbox": "1.9.3",
        "@workflow/world-vercel": "4.1.0",
        ai: "6.0.159",
        effect: "3.21.2",
        "lucide-react": "0.577.0",
        ms: "^2.1.3",
        next: "16.2.3",
        react: "19.2.5",
        "react-dom": "19.2.5",
        workflow: "4.2.2"
      },
      devDependencies: {
        "@types/ms": "^2.1.0",
        "@types/node": "25.3.5",
        "@types/react": "19.2.14",
        "@types/react-dom": "19.2.3",
        "babel-plugin-react-compiler": "^1.0.0",
        tailwindcss: "4.2.1",
        typescript: "^5.9.3"
      },
      packageManager: "bun@1.2.5",
      version: "0.1.0"
    })
    const nextConfig = 'import { withWorkflow } from "workflow/next"\n\nexport default withWorkflow({})\n'

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === "https://example.test/package.json") {
        return new Response(rootPackageJson)
      }

      if (url === "https://example.test/www/package.json") {
        return new Response(wwwPackageJson)
      }

      if (url === "https://example.test/www/next.config.ts") {
        return new Response(nextConfig)
      }

      if (url.startsWith("https://api.vercel.com/v2/files")) {
        uploadedBodies.push(new TextDecoder().decode(init?.body as ArrayBuffer))
        return new Response(null, { status: 200 })
      }

      return new Response("unexpected URL", { status: 500 })
    }) as typeof fetch

    try {
      await uploadSkillRunnerShellSourceFiles({
        accessToken: "test-token",
        source: {
          commit: "test-commit",
          files: [
            {
              contentUrl: "https://example.test/package.json",
              path: "package.json"
            },
            {
              contentUrl: "https://example.test/www/package.json",
              path: "www/package.json"
            },
            {
              contentUrl: "https://example.test/www/next.config.ts",
              path: "www/next.config.ts"
            }
          ],
          version: "test-version"
        },
        teamId: "team_test"
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(uploadedBodies).toHaveLength(3)
    const parsedBodies = uploadedBodies.map((body) => {
      try {
        return JSON.parse(body) as Record<string, unknown>
      } catch {
        return null
      }
    })
    const rootPackage = parsedBodies.find((body) => body?.name === "dev3000-skill-runner-root")
    const wwwPackage = parsedBodies.find((body) => body?.name === "dev3000-skill-runner") as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      name?: string
    } | null
    const patchedNextConfig = uploadedBodies.find((body) => body.includes("withWorkflow"))

    expect(rootPackage).toMatchObject({
      name: "dev3000-skill-runner-root",
      private: true,
      workspaces: ["www"]
    })
    expect(wwwPackage?.dependencies).toMatchObject({
      "@vercel/blob": "2.3.1",
      "@vercel/oidc": "3.2.0",
      "@vercel/sandbox": "1.9.3",
      effect: "3.21.2",
      next: "16.2.3",
      workflow: "4.2.2"
    })
    expect(wwwPackage?.dependencies).not.toHaveProperty("@radix-ui/react-dialog")
    expect(wwwPackage?.dependencies).not.toHaveProperty("lucide-react")
    expect(wwwPackage?.devDependencies).toHaveProperty("@types/ms")
    expect(wwwPackage?.devDependencies).toHaveProperty("typescript")
    expect(wwwPackage?.devDependencies).not.toHaveProperty("babel-plugin-react-compiler")
    expect(wwwPackage?.devDependencies).not.toHaveProperty("tailwindcss")
    expect(patchedNextConfig).toContain('process.env.VERCEL_PREVIEW_COMMENTS_ENABLED = "0"')
    expect(patchedNextConfig).toContain('import { withWorkflow } from "workflow/next"')
    expect(patchedNextConfig).toContain('outputFileTracingRoot: path.join(currentDir, "..")')
    expect(patchedNextConfig).not.toContain("reactCompiler")
    expect(patchedNextConfig).not.toContain("cacheComponents")
    expect(patchedNextConfig).not.toContain("typedRoutes")
    expect(patchedNextConfig).not.toContain("optimisticRouting")
  })
})

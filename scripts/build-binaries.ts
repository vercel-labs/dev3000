#!/usr/bin/env bun

/**
 * Build script for creating standalone d3k binaries using Bun's native compilation.
 *
 * This script:
 * 1. Builds the MCP server (Next.js)
 * 2. Compiles the CLI into a standalone binary for darwin-arm64
 * 3. Embeds necessary assets (MCP server build, skills, etc.)
 */

import { $ } from "bun"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs"
import { dirname, join } from "path"

const ROOT_DIR = dirname(dirname(import.meta.path))
const DIST_BIN_DIR = join(ROOT_DIR, "dist-bin")
const MCP_SERVER_DIR = join(ROOT_DIR, "mcp-server")

// Read version from package.json
function getPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"))
  return packageJson.version
}

// Target platforms (darwin-arm64 only for now)
const TARGETS = [
  { os: "darwin", arch: "arm64", name: "d3k-darwin-arm64" }
  // { os: "darwin", arch: "x64", name: "d3k-darwin-x64" },  // Add later
] as const

async function cleanDistBin() {
  console.log("🧹 Cleaning dist-bin directory...")
  if (existsSync(DIST_BIN_DIR)) {
    rmSync(DIST_BIN_DIR, { recursive: true })
  }
  mkdirSync(DIST_BIN_DIR, { recursive: true })
}

async function buildMcpServer() {
  console.log("📦 Building MCP server...")
  await $`cd ${MCP_SERVER_DIR} && bun run build`
  console.log("✅ MCP server built successfully")
}

async function buildMainPackage() {
  console.log("📦 Building main package with TypeScript...")
  await $`cd ${ROOT_DIR} && bun run build`
  console.log("✅ Main package built successfully")
}

async function compileForTarget(target: (typeof TARGETS)[number]) {
  const targetDir = join(DIST_BIN_DIR, target.name)
  const binDir = join(targetDir, "bin")
  const bunTarget = `bun-${target.os}-${target.arch}`
  const version = getPackageVersion()

  console.log(`\n🔨 Compiling for ${bunTarget} (v${version})...`)

  // Create output directories
  mkdirSync(binDir, { recursive: true })

  // Use bun build --compile to create standalone binary
  // Note: We compile the TypeScript directly, Bun handles transpilation
  const entrypoint = join(ROOT_DIR, "src", "cli.ts")
  const outputBinary = join(binDir, "dev3000")

  try {
    // Use --define to inject the version at compile time
    await $`bun build ${entrypoint} --compile --target=${bunTarget} --outfile=${outputBinary} --define __D3K_VERSION__='"${version}"'`
    console.log(`✅ Binary created: ${outputBinary}`)
  } catch (error) {
    console.error(`❌ Failed to compile for ${bunTarget}:`, error)
    throw error
  }

  // Copy MCP server build output to be bundled with the package
  // The binary will need to extract/reference these at runtime
  const mcpDest = join(targetDir, "mcp-server")
  console.log("📁 Copying MCP server assets...")

  mkdirSync(mcpDest, { recursive: true })

  // Copy the built .next directory
  const nextDir = join(MCP_SERVER_DIR, ".next")
  if (existsSync(nextDir)) {
    cpSync(nextDir, join(mcpDest, ".next"), { recursive: true })
  }

  // Copy package.json for the MCP server (needed to run it)
  cpSync(join(MCP_SERVER_DIR, "package.json"), join(mcpDest, "package.json"))

  // Copy node_modules (production deps only would be better, but for now copy all)
  // Use dereference: true to resolve pnpm's symlinks to actual files
  const nodeModules = join(MCP_SERVER_DIR, "node_modules")
  if (existsSync(nodeModules)) {
    console.log("📁 Copying MCP server node_modules (this may take a moment)...")
    cpSync(nodeModules, join(mcpDest, "node_modules"), { recursive: true, dereference: true })

    // Fix executable permissions on .bin directory (lost when dereferencing symlinks)
    const binDir = join(mcpDest, "node_modules", ".bin")
    if (existsSync(binDir)) {
      console.log("🔧 Fixing .bin permissions...")
      await $`chmod +x ${binDir}/*`
    }
  }

  // Copy start script
  const startScript = join(MCP_SERVER_DIR, "start-production.mjs")
  if (existsSync(startScript)) {
    cpSync(startScript, join(mcpDest, "start-production.mjs"))
  }

  // Copy skills directory
  const skillsDir = join(ROOT_DIR, "src", "skills")
  if (existsSync(skillsDir)) {
    console.log("📁 Copying skills...")
    cpSync(skillsDir, join(targetDir, "skills"), { recursive: true })
  }

  // Copy loading.html
  const loadingHtml = join(ROOT_DIR, "src", "loading.html")
  if (existsSync(loadingHtml)) {
    mkdirSync(join(targetDir, "src"), { recursive: true })
    cpSync(loadingHtml, join(targetDir, "src", "loading.html"))
  }

  console.log(`✅ Platform package prepared: ${targetDir}`)
}

async function main() {
  console.log("🚀 Starting d3k binary build process...\n")

  try {
    await cleanDistBin()
    await buildMcpServer()
    await buildMainPackage()

    for (const target of TARGETS) {
      await compileForTarget(target)
    }

    console.log("\n✅ Build complete!")
    console.log(`\nTo test the binary directly:`)
    console.log(`  ./dist-bin/d3k-darwin-arm64/bin/dev3000 --version`)
  } catch (error) {
    console.error("\n❌ Build failed:", error)
    process.exit(1)
  }
}

main()

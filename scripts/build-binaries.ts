#!/usr/bin/env bun

/**
 * Build script for creating standalone d3k binaries using Bun's native compilation.
 *
 * This script:
 * 1. Compiles the CLI into a standalone binary for darwin-arm64
 * 2. Embeds necessary assets (skills, etc.)
 */

import { $ } from "bun"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs"
import { dirname, join } from "path"

import { formatBuildVersion } from "../src/utils/build-version.js"

const ROOT_DIR = dirname(dirname(import.meta.path))
const DIST_BIN_DIR = join(ROOT_DIR, "dist-bin")

// Read version from package.json
function getPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"))
  return packageJson.version
}

function getBinaryVersion(version: string): string {
  return formatBuildVersion(version, process.env.D3K_CANARY_BUILD_STAMP)
}

// Target platforms
const TARGETS = [
  { os: "darwin", arch: "arm64", name: "d3k-darwin-arm64" },
  { os: "linux", arch: "x64", name: "d3k-linux-x64" },
  { os: "windows", arch: "x64", name: "d3k-windows-x64" }
] as const

const TARGET_KEYS = TARGETS.map((target) => `${target.os}-${target.arch}` as const)

function getSelectedTargets() {
  const raw = process.env.D3K_BUILD_TARGETS?.trim()
  if (!raw) return TARGETS
  const requested = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  const selected = TARGETS.filter((target) => requested.includes(`${target.os}-${target.arch}`))
  if (selected.length === 0) {
    console.warn(`⚠️ D3K_BUILD_TARGETS set to "${raw}" but no matches found. Valid targets: ${TARGET_KEYS.join(", ")}`)
    return TARGETS
  }
  return selected
}

async function cleanDistBin() {
  console.log("🧹 Cleaning dist-bin directory...")
  if (existsSync(DIST_BIN_DIR)) {
    rmSync(DIST_BIN_DIR, { recursive: true })
  }
  mkdirSync(DIST_BIN_DIR, { recursive: true })
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
  const packageVersion = getPackageVersion()
  const binaryVersion = getBinaryVersion(packageVersion)
  const isWindows = target.os === "windows"

  console.log(`\n🔨 Compiling for ${bunTarget} (v${binaryVersion})...`)

  // Create output directories
  mkdirSync(binDir, { recursive: true })

  // Use bun build --compile to create standalone binary
  // Note: We compile the TypeScript directly, Bun handles transpilation
  const entrypoint = join(ROOT_DIR, "src", "cli.ts")
  // Windows binaries need .exe extension
  const outputBinary = join(binDir, isWindows ? "dev3000.exe" : "dev3000")

  try {
    // Use --define to inject the version at compile time
    await $`bun build ${entrypoint} --compile --target=${bunTarget} --outfile=${outputBinary} --define __D3K_VERSION__='"${binaryVersion}"'`
    console.log(`✅ Binary created: ${outputBinary}`)
  } catch (error) {
    console.error(`❌ Failed to compile for ${bunTarget}:`, error)
    throw error
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
    await buildMainPackage()

    for (const target of getSelectedTargets()) {
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

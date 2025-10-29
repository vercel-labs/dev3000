#!/usr/bin/env node

// Lint rule: Disallow invoking `npx` anywhere in code/config (shell, package.json scripts, TS/JS)
// Motivation: npx ephemeral cache causes noisy ENOTEMPTY cleanup warnings under Docker/WSL.
// Allowed: documentation, comments, and paths like /root/.npm/_npx.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, sep } from "node:path"

const roots = [
  // code and configs only
  "src",
  "scripts",
  "mcp-server/app",
  "frontend",
  // examples are considered user-facing; still check code but not docs within them
  "example"
]

const ignoreDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "mcp-server/app/.next",
  "docs",
  "chrome-extension",
  "frontend/.dev3000"
])

// Files to scan generically
const codeExts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".bash", "", ".yml", ".yaml", ".json"]) // "" for Dockerfile/Makefile

// Allowlist of basenames we want to scan even w/o extension
const specialBasenames = new Set(["Dockerfile", "Dockerfile.dev", "Makefile"])

const offenders = []

function shouldIgnore(fullPath) {
  const normalized = fullPath.split(sep).join("/")
  for (const ig of ignoreDirs) {
    if (normalized === ig || normalized.endsWith(`/${ig}`) || normalized.includes(`/${ig}/`)) return true
  }
  // Ignore Markdown and text docs
  if (/\.(md|markdown|txt)$/i.test(normalized)) return true
  return false
}

function scanPackageJson(full) {
  try {
    const json = JSON.parse(readFileSync(full, "utf8"))
    const scripts = json.scripts || {}
    for (const [name, val] of Object.entries(scripts)) {
      if (typeof val === "string" && /(^|\s)npx(\s|$)/.test(val)) {
        offenders.push(`${full} (script ${name}) -> ${val}`)
      }
    }
  } catch {}
}

function stripShellComments(s) {
  return s
    .split(/\r?\n/)
    .map((line) => (line.trimStart().startsWith("#") ? "" : line))
    .join("\n")
}

function stripShellQuoted(s) {
  // Remove content within single or double quotes to avoid false positives in echo strings
  return s.replace(/"[^"]*"|'[^']*'/g, "")
}

function stripJsComments(s) {
  // Simple heuristics: remove // line comments and /* */ blocks
  const noLine = s.replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, "\n")
  const noBlock = noLine.replace(/\/\*[\s\S]*?\*\//g, "")
  return noBlock
}

function scanGeneric(full) {
  let txt = readFileSync(full, "utf8")
  const ext = extname(full)
  const _base = full.split(/[\\/]/).pop()

  // Skip binary-like big files
  try {
    const st = statSync(full)
    if (st.size > 1024 * 1024) return
  } catch {}

  if (ext === ".sh" || ext === ".bash") {
    txt = stripShellComments(txt)
    txt = stripShellQuoted(txt)
  } else if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    txt = stripJsComments(txt)
  }

  // Detect explicit npx command invocations only (not paths like _npx or messages)
  const commandPattern = /(^|[\s;&|])npx(\s|$)/m
  const spawnPattern = /spawn\s*\(\s*['"]npx['"]/m
  const execPattern = /exec(?:Sync)?\s*\(\s*['"][^'"\n]*\bnpx\b/m

  if (commandPattern.test(txt) || spawnPattern.test(txt) || execPattern.test(txt)) {
    offenders.push(full)
  }
}

function scanDir(dir) {
  let ents
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of ents) {
    const full = join(dir, ent.name)
    if (shouldIgnore(full)) continue
    try {
      const st = statSync(full)
      if (st.isDirectory()) {
        scanDir(full)
      } else if (st.isFile()) {
        const base = ent.name
        const ext = extname(base)
        if (base === "package.json") {
          scanPackageJson(full)
        } else if (codeExts.has(ext) || specialBasenames.has(base)) {
          scanGeneric(full)
        }
      }
    } catch {}
  }
}

for (const root of roots) scanDir(root)

if (offenders.length > 0) {
  console.error("\n❌ Lint: Disallowed 'npx' command invocation detected in code/scripts:")
  for (const o of offenders) console.error("  ", o)
  console.error("\nUse 'bunx' instead (preferred), or 'pnpm dlx' if bunx is unavailable.")
  process.exit(1)
} else {
  process.exit(0)
}

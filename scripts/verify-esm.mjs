#!/usr/bin/env node

// Verify ESM-only usage across TS/JS code
// Fails if `require(` is used in .ts or .js files (except build outputs)

import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, sep } from "node:path"

const roots = ["src", "mcp-server/app", "scripts"]
const ignoreDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "mcp-server/app/.next",
  "frontend",
  "example",
  "chrome-extension"
])

const exts = new Set([".ts", ".js"]) // .cjs intentionally excluded
const offenders = []

function shouldIgnore(fullPath, _name) {
  // Normalize path separators for cross-platform matching
  const normalized = fullPath.split(sep).join("/")
  for (const ig of ignoreDirs) {
    if (normalized === ig || normalized.endsWith(`/${ig}`) || normalized.includes(`/${ig}/`)) return true
  }
  return false
}

function scanDir(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (shouldIgnore(full, ent.name)) continue
    try {
      const st = statSync(full)
      if (st.isDirectory()) {
        scanDir(full)
      } else if (st.isFile()) {
        const ext = extname(ent.name)
        if (!exts.has(ext)) continue
        // Read small files only up to 1MB
        if (st.size > 1024 * 1024) continue
        const txt = readFileSync(full, "utf8")
        // Mask template literal content to avoid false positives for code strings
        const masked = (() => {
          let out = ""
          let inTpl = false
          let esc = false
          for (let i = 0; i < txt.length; i++) {
            const ch = txt[i]
            if (inTpl) {
              if (ch === "`" && !esc) {
                inTpl = false
                out += "`"
                esc = false
                continue
              }
              // preserve newlines for line alignment
              out += ch === "\n" ? "\n" : " "
              esc = ch === "\\" && !esc
            } else {
              if (ch === "`" && !esc) {
                inTpl = true
                out += "`"
                esc = false
                continue
              }
              out += ch
              esc = ch === "\\" && !esc
            }
          }
          return out
        })()
        // Look for actual require( ... ), avoiding property access like obj.require
        const re = /(?:^|[^.$\w])require\s*\(/
        if (re.test(masked)) {
          // Collect matching lines for better output
          const lines = masked.split(/\r?\n/)
          lines.forEach((line, i) => {
            if (re.test(line)) {
              offenders.push(`${full}:${i + 1}`)
            }
          })
        }
      }
    } catch {
      // ignore
    }
  }
}

for (const root of roots) scanDir(root)

if (offenders.length > 0) {
  console.error("\n❌ ESM enforcement failed: 'require(' found in the following files:")
  for (const o of offenders) console.error("  ", o)
  console.error("\nPlease replace CommonJS require() with ESM imports.")
  process.exit(1)
} else {
  // Be quiet on success to not pollute lint output
  process.exit(0)
}

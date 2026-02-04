import { mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export function getD3kHomeDir(): string {
  return join(homedir(), ".d3k")
}

export function ensureD3kHomeDir(): string {
  const dir = getD3kHomeDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

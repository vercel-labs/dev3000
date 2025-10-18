#!/usr/bin/env node

/**
 * dev3000-down.mjs
 *
 * Graceful shutdown script for dev3000 Docker environment
 *
 * Steps:
 * 1. Stop Docker Compose containers
 * 2. Kill Chrome process
 * 3. Clean up temporary files
 */

import { exec } from 'child_process'
import { existsSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function error(message) {
  console.error(`${colors.red}❌ ${message}${colors.reset}`)
}

function success(message) {
  log(`✅ ${message}`, 'green')
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan')
}

function warn(message) {
  log(`⚠️  ${message}`, 'yellow')
}

/**
 * Stop Docker Compose
 */
async function stopDocker() {
  info('Stopping Docker containers...')

  const dockerDir = join(process.cwd(), 'docker')

  if (!existsSync(dockerDir)) {
    warn(`Docker directory not found: ${dockerDir}`)
    return
  }

  try {
    await execAsync('docker compose down', { cwd: dockerDir })
    success('Docker containers stopped')
  } catch (err) {
    error(`Failed to stop Docker: ${err.message}`)
  }
}

/**
 * Kill Chrome process
 */
async function killChrome() {
  const pidFile = join(tmpdir(), 'dev3000-chrome.pid')

  if (!existsSync(pidFile)) {
    info('No Chrome PID file found (already stopped or not started)')
    return
  }

  try {
    const pid = readFileSync(pidFile, 'utf-8').trim()
    info(`Killing Chrome (PID ${pid})...`)

    if (process.platform === 'win32') {
      // Windows: Use taskkill with /T for tree kill
      await execAsync(`taskkill /PID ${pid} /F /T`)
    } else {
      // Unix: Use kill -9
      await execAsync(`kill -9 ${pid}`)
    }

    // Delete PID file
    unlinkSync(pidFile)
    success('Chrome process stopped')
  } catch (err) {
    if (err.message.includes('No such process') || err.message.includes('not found')) {
      warn('Chrome process already stopped')
      // Clean up PID file
      if (existsSync(pidFile)) {
        unlinkSync(pidFile)
      }
    } else {
      error(`Failed to stop Chrome: ${err.message}`)
    }
  }
}

/**
 * Clean up temporary files
 */
function cleanup() {
  info('Cleaning up temporary files...')

  const tmpFiles = [
    join(tmpdir(), 'dev3000-chrome.pid')
  ]

  let cleaned = 0
  for (const file of tmpFiles) {
    if (existsSync(file)) {
      try {
        unlinkSync(file)
        cleaned++
      } catch {
        // Ignore errors
      }
    }
  }

  if (cleaned > 0) {
    success(`Cleaned up ${cleaned} temporary file(s)`)
  }
}

/**
 * Main function
 */
async function main() {
  log('\\n🛑 Dev3000 Docker Shutdown\\n', 'bright')

  try {
    // Stop Docker first
    await stopDocker()

    // Then kill Chrome
    await killChrome()

    // Clean up
    cleanup()

    log('\\n✨ Dev3000 stopped successfully\\n', 'green')
  } catch (err) {
    error(`Shutdown failed: ${err.message}`)
    console.error(err)
    process.exit(1)
  }
}

// Run main function
main()

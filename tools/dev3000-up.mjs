#!/usr/bin/env node

/**
 * dev3000-up.mjs
 *
 * Automated startup script for dev3000 Docker environment
 * Cross-platform support: WSL, Linux, macOS, Windows
 *
 * Steps:
 * 1. Detect platform
 * 2. Find and launch Chrome with CDP
 * 3. Get CDP WebSocket URL
 * 4. Start Docker Compose with CDP URL
 */

import { spawn, exec } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
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
  log(`ℹ️  ${message}`, 'blue')
}

function warn(message) {
  log(`⚠️  ${message}`, 'yellow')
}

/**
 * Detect platform (WSL, Linux, macOS, Windows)
 */
function detectPlatform() {
  const platform = process.platform

  if (platform === 'darwin') {
    return 'macos'
  } else if (platform === 'win32') {
    return 'windows'
  } else if (platform === 'linux') {
    // Check if WSL
    try {
      const { execSync } = require('child_process')
      const releaseInfo = execSync('cat /proc/version 2>/dev/null || echo ""', { encoding: 'utf-8' })
      if (releaseInfo.toLowerCase().includes('microsoft') || releaseInfo.toLowerCase().includes('wsl')) {
        return 'wsl'
      }
    } catch {
      // Not WSL
    }
    return 'linux'
  }

  return 'unknown'
}

/**
 * Find Chrome executable based on platform
 */
function findChrome(platform) {
  const chromePaths = {
    macos: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    wsl: [
      // Windows Chrome paths accessible from WSL
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
      '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      // Linux Chrome as fallback
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium', // Snap (may have CDP issues)
      '/var/lib/flatpak/exports/bin/com.google.Chrome' // Flatpak (may have CDP issues)
    ],
    windows: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ]
  }

  const paths = chromePaths[platform] || []

  log(`\n🔍 Searching for Chrome executable...`, 'cyan')
  log(`Platform: ${platform}`)
  log(`Checking ${paths.length} possible locations:\n`)

  for (const path of paths) {
    log(`  Checking: ${path}`)
    if (existsSync(path)) {
      success(`  ✓ Found Chrome at: ${path}`)

      // Warn about Snap/Flatpak
      if (path.includes('snap') || path.includes('flatpak')) {
        warn(`\n⚠️  SNAP/FLATPAK CHROME DETECTED`)
        warn(`Location: ${path}`)
        warn(`Issue: Snap/Flatpak Chrome may have CDP restrictions`)
        warn(`Recommendation: Install system Chrome (.deb package)`)
        warn(`Download: https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb\n`)
      }
      return path
    }
  }

  // Detailed error message when Chrome not found
  error('\n❌ CHROME NOT FOUND')
  error(`Platform: ${platform}`)
  error(`\nSearched ${paths.length} locations:`)
  paths.forEach(p => error(`  ✗ ${p}`))
  error('\n📋 INSTALLATION INSTRUCTIONS:')

  if (platform === 'macos') {
    error('  macOS: brew install --cask google-chrome')
    error('  Or download: https://www.google.com/chrome/')
  } else if (platform === 'wsl') {
    error('  WSL: Install on Windows (preferred):')
    error('    Download: https://www.google.com/chrome/')
    error('  Or install in WSL:')
    error('    wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb')
    error('    sudo dpkg -i google-chrome-stable_current_amd64.deb')
  } else if (platform === 'linux') {
    error('  Ubuntu/Debian:')
    error('    wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb')
    error('    sudo dpkg -i google-chrome-stable_current_amd64.deb')
    error('  Fedora/RHEL:')
    error('    sudo dnf install google-chrome-stable')
  } else if (platform === 'windows') {
    error('  Windows: Download from https://www.google.com/chrome/')
  }
  error('')

  return null
}

/**
 * Launch Chrome with CDP enabled
 */
async function launchChrome(chromePath, platform) {
  const cdpPort = 9222
  const profileDir = join(tmpdir(), 'dev3000-chrome-profile')

  info(`Launching Chrome with CDP on port ${cdpPort}...`)
  info(`Profile directory: ${profileDir}`)

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--metrics-recording-only',
    'about:blank'
  ]

  // Launch Chrome process
  const chromeProcess = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore'
  })

  // Unref so parent can exit
  chromeProcess.unref()

  // Store PID for cleanup
  const pidFile = join(tmpdir(), 'dev3000-chrome.pid')
  writeFileSync(pidFile, chromeProcess.pid.toString())

  success(`Chrome launched with PID ${chromeProcess.pid}`)

  // Wait for Chrome to be ready
  info('Waiting for Chrome to initialize...')

  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`http://localhost:${cdpPort}/json`)
      if (response.ok) {
        success('Chrome is ready!')
        return cdpPort
      }
    } catch {
      // Chrome not ready yet
    }

    await new Promise(resolve => setTimeout(resolve, 500))
    attempts++
  }

  throw new Error('Chrome failed to start within timeout')
}

/**
 * Get CDP WebSocket URL
 */
async function getCdpUrl(cdpPort) {
  info('Fetching CDP WebSocket URL...')

  try {
    const cdpEndpoint = `http://localhost:${cdpPort}/json`
    log(`Connecting to: ${cdpEndpoint}`)

    const response = await fetch(cdpEndpoint)

    if (!response.ok) {
      error('\n❌ CDP ENDPOINT REQUEST FAILED')
      error(`URL: ${cdpEndpoint}`)
      error(`Status: ${response.status} ${response.statusText}`)
      error(`\nCAUSE: Chrome may not be fully started or CDP port is blocked`)
      error(`\nDEBUG STEPS:`)
      error(`  1. Check if Chrome is running: ps aux | grep chrome`)
      error(`  2. Check CDP port: curl http://localhost:${cdpPort}/json`)
      error(`  3. Check firewall: sudo ufw status`)
      throw new Error(`CDP endpoint returned ${response.status}`)
    }

    const targets = await response.json()
    log(`Found ${targets.length} Chrome targets`)

    const pageTarget = targets.find(t => t.type === 'page')
    if (!pageTarget) {
      error('\n❌ NO PAGE TARGET FOUND IN CHROME')
      error(`Available targets:`)
      targets.forEach((t, i) => {
        error(`  [${i}] Type: ${t.type}, Title: ${t.title || 'N/A'}`)
      })
      error(`\nCAUSE: Chrome started but no page/tab is available`)
      error(`EXPECTED: At least one target with type='page'`)
      error(`ACTUAL: ${targets.length} targets, none are pages`)
      error(`\nDEBUG STEPS:`)
      error(`  1. Open Chrome manually and check if about:blank loaded`)
      error(`  2. Check Chrome stderr for startup errors`)
      error(`  3. Try: curl http://localhost:${cdpPort}/json | jq`)
      throw new Error('No page target found in Chrome')
    }

    const wsUrl = pageTarget.webSocketDebuggerUrl
    success(`CDP URL: ${wsUrl}`)
    log(`Page title: ${pageTarget.title || 'about:blank'}`)

    return wsUrl
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      error('\n❌ CDP CONNECTION REFUSED')
      error(`Port: ${cdpPort}`)
      error(`\nCAUSE: Chrome is not listening on port ${cdpPort}`)
      error(`\nPOSSIBLE REASONS:`)
      error(`  1. Chrome failed to start`)
      error(`  2. Chrome crashed during startup`)
      error(`  3. Wrong port number`)
      error(`  4. Another process is using port ${cdpPort}`)
      error(`\nDEBUG STEPS:`)
      error(`  1. Check port usage: lsof -i :${cdpPort}`)
      error(`  2. Check Chrome process: ps aux | grep chrome`)
      error(`  3. Check Chrome logs in the output above`)
    }
    throw err
  }
}

/**
 * Convert CDP URL for Docker
 * ws://localhost:9222/... → ws://host.docker.internal:9222/...
 */
function convertCdpUrlForDocker(wsUrl, platform) {
  if (platform === 'wsl' || platform === 'linux' || platform === 'macos') {
    // Replace localhost with host.docker.internal
    return wsUrl.replace('localhost', 'host.docker.internal')
  } else if (platform === 'windows') {
    // Windows Docker Desktop uses host.docker.internal natively
    return wsUrl.replace('localhost', 'host.docker.internal')
  }

  return wsUrl
}

/**
 * Start Docker Compose
 */
async function startDocker(cdpUrl) {
  info('Starting Docker Compose...')

  // Change to docker directory
  const dockerDir = join(process.cwd(), 'docker')

  log(`Docker directory: ${dockerDir}`)

  if (!existsSync(dockerDir)) {
    error('\n❌ DOCKER DIRECTORY NOT FOUND')
    error(`Expected path: ${dockerDir}`)
    error(`Current working directory: ${process.cwd()}`)
    error(`\nCAUSE: Docker configuration files are missing`)
    error(`\nREQUIRED FILES:`)
    error(`  ${join(dockerDir, 'Dockerfile')}`)
    error(`  ${join(dockerDir, 'docker-compose.yml')}`)
    error(`\nDEBUG STEPS:`)
    error(`  1. Check if you're in the dev3000 repository root`)
    error(`  2. Verify docker/ directory exists: ls -la docker/`)
    error(`  3. Clone repository if missing: git clone https://github.com/vercel-labs/dev3000.git`)
    throw new Error(`Docker directory not found: ${dockerDir}`)
  }

  // Verify required files
  const dockerfile = join(dockerDir, 'Dockerfile')
  const composeFile = join(dockerDir, 'docker-compose.yml')

  if (!existsSync(dockerfile)) {
    error('\n❌ DOCKERFILE NOT FOUND')
    error(`Expected: ${dockerfile}`)
    error(`\nREQUIRED: Dockerfile must exist to build the image`)
    throw new Error('Dockerfile not found')
  }

  if (!existsSync(composeFile)) {
    error('\n❌ DOCKER-COMPOSE.YML NOT FOUND')
    error(`Expected: ${composeFile}`)
    error(`\nREQUIRED: docker-compose.yml must exist to orchestrate containers`)
    throw new Error('docker-compose.yml not found')
  }

  // Set environment variable for docker-compose
  process.env.DEV3000_CDP_URL = cdpUrl

  info(`Using CDP URL: ${cdpUrl}`)
  log(`Environment: DEV3000_CDP_URL=${cdpUrl}`)

  // Check if Docker is available
  try {
    const { execSync } = require('child_process')
    execSync('docker --version', { stdio: 'ignore' })
  } catch (err) {
    error('\n❌ DOCKER NOT FOUND')
    error(`\nCAUSE: Docker command is not available in PATH`)
    error(`\nINSTALLATION:`)
    error(`  macOS: brew install --cask docker`)
    error(`  Ubuntu: https://docs.docker.com/engine/install/ubuntu/`)
    error(`  Windows: https://docs.docker.com/desktop/install/windows-install/`)
    error(`\nVERIFY: docker --version`)
    throw new Error('Docker is not installed or not in PATH')
  }

  log('Docker version check: ✓')

  // Run docker compose up
  log(`Running: docker compose up --build`)
  log(`Working directory: ${dockerDir}\n`)

  const dockerProcess = spawn('docker', ['compose', 'up', '--build'], {
    cwd: dockerDir,
    stdio: 'inherit',
    env: process.env
  })

  return new Promise((resolve, reject) => {
    dockerProcess.on('error', (err) => {
      error('\n❌ DOCKER PROCESS ERROR')
      error(`Error: ${err.message}`)
      error(`Code: ${err.code || 'N/A'}`)
      if (err.code === 'ENOENT') {
        error(`\nCAUSE: 'docker' command not found`)
        error(`\nDEBUG STEPS:`)
        error(`  1. Install Docker: https://docs.docker.com/get-docker/`)
        error(`  2. Verify installation: docker --version`)
        error(`  3. Check PATH: echo $PATH`)
      }
      reject(err)
    })

    dockerProcess.on('exit', (code, signal) => {
      if (code === 0) {
        success('\nDocker stopped gracefully')
        resolve()
      } else {
        warn(`\n⚠️  DOCKER EXITED`)
        warn(`Exit code: ${code || 'N/A'}`)
        warn(`Signal: ${signal || 'N/A'}`)

        if (code && code !== 0) {
          error(`\nCAUSE: Docker Compose exited with non-zero code`)
          error(`\nCOMMON CAUSES:`)
          error(`  - Build errors (check Dockerfile)`)
          error(`  - Port conflicts (ports 3000 or 3684 in use)`)
          error(`  - Volume mount issues`)
          error(`  - CDP connection failures`)
          error(`\nDEBUG STEPS:`)
          error(`  1. Check logs above for specific errors`)
          error(`  2. Verify ports: lsof -i :3000 && lsof -i :3684`)
          error(`  3. Check Docker logs: docker compose logs -f dev3000`)
          error(`  4. Try manual start: cd docker && docker compose up`)
        }
        resolve() // Don't reject, just exit
      }
    })
  })
}

/**
 * Cleanup on exit
 */
function setupCleanup() {
  const pidFile = join(tmpdir(), 'dev3000-chrome.pid')

  const cleanup = async () => {
    info('\\nShutting down...')

    // Stop Docker
    try {
      const dockerDir = join(process.cwd(), 'docker')
      if (existsSync(dockerDir)) {
        info('Stopping Docker containers...')
        await execAsync('docker compose down', { cwd: dockerDir })
        success('Docker stopped')
      }
    } catch (err) {
      warn(`Failed to stop Docker: ${err.message}`)
    }

    // Kill Chrome
    try {
      if (existsSync(pidFile)) {
        const pid = require('fs').readFileSync(pidFile, 'utf-8').trim()
        info(`Killing Chrome (PID ${pid})...`)

        if (process.platform === 'win32') {
          await execAsync(`taskkill /PID ${pid} /F /T`)
        } else {
          await execAsync(`kill -9 ${pid}`)
        }

        require('fs').unlinkSync(pidFile)
        success('Chrome stopped')
      }
    } catch (err) {
      warn(`Failed to stop Chrome: ${err.message}`)
    }

    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

/**
 * Main function
 */
async function main() {
  log('\\n🚀 Dev3000 Docker Startup\\n', 'bright')

  try {
    // Detect platform
    const platform = detectPlatform()
    info(`Platform detected: ${platform}`)

    // Find Chrome
    const chromePath = findChrome(platform)
    if (!chromePath) {
      error('Chrome not found!')
      error('Please install Google Chrome and try again.')
      process.exit(1)
    }
    success(`Chrome found: ${chromePath}`)

    // Launch Chrome
    const cdpPort = await launchChrome(chromePath, platform)

    // Get CDP URL
    const wsUrl = await getCdpUrl(cdpPort)

    // Convert URL for Docker
    const dockerCdpUrl = convertCdpUrlForDocker(wsUrl, platform)
    info(`Docker CDP URL: ${dockerCdpUrl}`)

    // Setup cleanup handlers
    setupCleanup()

    // Start Docker
    log('\\n📦 Starting Docker environment...\\n', 'cyan')
    await startDocker(dockerCdpUrl)

  } catch (err) {
    error(`Failed to start dev3000: ${err.message}`)
    console.error(err)
    process.exit(1)
  }
}

// Run main function
main()

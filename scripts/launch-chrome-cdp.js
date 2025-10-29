#!/usr/bin/env node

/**
 * Cross-platform Chrome launcher with CDP enabled.
 * Works from WSL, Windows (PowerShell/cmd), macOS, and Linux.
 *
 * Usage:
 *   node scripts/launch-chrome-cdp.js --app-url <url> --check-url <http://host:9222/json/version> --cdp-port 9222
 */

import { spawn, spawnSync } from "node:child_process"
import http from "node:http"
import os from "node:os"
import readline from "node:readline"

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { appUrl: "http://localhost:3000/", checkUrl: "http://localhost:9222/json/version", cdpPort: 9222 }
  for (let i = 0; i < args.length; i++) {
    const k = args[i]
    const v = args[i + 1]
    if (k === "--app-url" && v) {
      opts.appUrl = v
      i++
    } else if (k === "--check-url" && v) {
      opts.checkUrl = v
      i++
    } else if (k === "--cdp-port" && v) {
      opts.cdpPort = parseInt(v, 10)
      i++
    }
  }
  return opts
}

function isWSL() {
  const rel = os.release().toLowerCase()
  return rel.includes("microsoft") || !!process.env.WSL_INTEROP || !!process.env.WSLENV
}

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: ["ignore", "pipe", "ignore"] })
  return r.status === 0
}

// Best-effort resolver for Windows curl.exe when running from WSL or Windows
function resolveWindowsCurl() {
  try {
    // Plain curl.exe on PATH (works on many WSL setups)
    const r = spawnSync("curl.exe", ["--version"], { stdio: "ignore" })
    if (r.status === 0) return "curl.exe"
  } catch {}

  // Fallback to WINDIR\System32 path if available
  if (process.env.WINDIR) {
    const candidate = `${process.env.WINDIR}\\System32\\curl.exe`
    try {
      const r2 = spawnSync(candidate, ["--version"], { stdio: "ignore" })
      if (r2.status === 0) return candidate
    } catch {}
  }
  return null
}

function runLogged(cmd, args, opts = {}) {
  console.log("Running:", cmd, args.join(" "))
  return spawn(cmd, args, { stdio: "inherit", ...opts })
}

function runSyncOk(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { stdio: "ignore" })
    return r.status === 0
  } catch {
    return false
  }
}

function windowsHave(cmd) {
  // Check existence of a Windows command via PowerShell Get-Command
  try {
    const r = spawnSync(isWSL() ? "powershell.exe" : "powershell", [
      "-Command",
      `if (Get-Command ${cmd} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`
    ])
    return r.status === 0
  } catch {
    return false
  }
}

async function ensureChromeInstalledWindowsLike() {
  // In Windows/WSL environments, installation typically requires elevation (admin).
  // We explicitly elevate using Start-Process -Verb RunAs and wait for completion.
  const ps = isWSL() ? "powershell.exe" : "powershell"

  const elevateAndWait = (command, argList) => {
    // Example produced command:
    // Start-Process winget -ArgumentList 'install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements' -Verb RunAs -Wait
    const cmd = `Start-Process ${command} -ArgumentList '${argList}' -Verb RunAs -Wait`
    return runLogged(ps, ["-Command", cmd])
  }

  // Try winget with elevation
  if (windowsHave("winget")) {
    console.log("winget detected; attempting elevated Chrome install via winget...")
    const proc = elevateAndWait(
      "winget",
      "install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements"
    )
    const code = await new Promise((res) => proc.on("exit", (c) => res(c ?? 1)))
    if (code === 0) return true
  }

  // Try chocolatey with elevation
  if (windowsHave("choco")) {
    console.log("choco detected; attempting elevated Chrome install via chocolatey...")
    const proc = elevateAndWait("choco", "install googlechrome -y")
    const code = await new Promise((res) => proc.on("exit", (c) => res(c ?? 1)))
    if (code === 0) return true
  }

  console.log("❌ Could not auto-install Chrome on Windows.")
  console.log("Please install Chrome from: https://www.google.com/chrome/")
  console.log("Or install via elevated command:")
  console.log(
    "  Start-Process winget -ArgumentList 'install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements' -Verb RunAs -Wait"
  )
  console.log("  Start-Process choco -ArgumentList 'install googlechrome -y' -Verb RunAs -Wait")
  return false
}

async function ensureChromeInstalledMac() {
  if (which("open")) {
    // Prefer Homebrew cask if available
    if (which("brew")) {
      console.log("Homebrew detected; attempting Chrome install via brew cask...")
      const proc = runLogged("brew", ["install", "--cask", "google-chrome"])
      const code = await new Promise((res) => proc.on("exit", (c) => res(c ?? 1)))
      if (code === 0) return true
    }
  }
  console.log("❌ Could not auto-install Chrome on macOS.")
  console.log("Please install Homebrew: https://brew.sh/")
  console.log("Then run: brew install --cask google-chrome")
  console.log("Or download Chrome: https://www.google.com/chrome/")
  return false
}

async function ensureChromeInstalledLinux() {
  // Try package managers: apt-get, dnf, pacman, zypper
  const tryList = []
  if (which("apt-get")) {
    tryList.push(["sudo", ["apt-get", "update", "-y"]])
    tryList.push(["sudo", ["apt-get", "install", "-y", "chromium-browser"]])
    tryList.push(["sudo", ["apt-get", "install", "-y", "chromium"]])
  } else if (which("dnf")) {
    tryList.push(["sudo", ["dnf", "install", "-y", "chromium"]])
  } else if (which("pacman")) {
    tryList.push(["sudo", ["pacman", "-Sy", "--noconfirm", "chromium"]])
  } else if (which("zypper")) {
    tryList.push(["sudo", ["zypper", "-n", "install", "chromium"]])
  }

  for (const [cmd, args] of tryList) {
    const proc = runLogged(cmd, args)
    const code = await new Promise((res) => proc.on("exit", (c) => res(c ?? 1)))
    if (code === 0) {
      // Re-check availability
      for (const c of ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]) {
        if (which(c)) return true
      }
    }
  }

  console.log("❌ Could not auto-install Chrome/Chromium on Linux.")
  console.log("Please install one of: google-chrome, google-chrome-stable, chromium-browser, chromium")
  console.log("Examples:")
  console.log("  Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y chromium-browser")
  console.log("  Fedora:        sudo dnf install -y chromium")
  console.log("  Arch:          sudo pacman -Sy --noconfirm chromium")
  return false
}

async function confirmInstall(message) {
  if (process.env.LAUNCH_CHROME_AUTO_INSTALL === "1") {
    console.log("Auto-install approved via LAUNCH_CHROME_AUTO_INSTALL=1")
    return true
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("Non-interactive environment. Skipping installation.")
    console.log("Set LAUNCH_CHROME_AUTO_INSTALL=1 to auto-install without prompt.")
    return false
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const question = (q) => new Promise((resolve) => rl.question(q, (ans) => resolve(ans)))
  const ans = (await question(`${message} Proceed? [y/N] `)).trim().toLowerCase()
  rl.close()
  return ans === "y" || ans === "yes"
}

function waitForAnyCdp(urls, retries = 5, delayMs = 1000) {
  return new Promise((resolve, reject) => {
    let attempt = 0

    const tryAttempt = () => {
      attempt++
      const candidates = Array.isArray(urls) ? urls : [urls]
      const tryOne = (index) => {
        if (index >= candidates.length) {
          if (attempt >= retries) {
            console.log(`⚠️  CDP endpoint not ready after ${retries} attempts for:`, candidates.join(", "))
            return reject(new Error("CDP not ready"))
          }
          return setTimeout(tryAttempt, delayMs)
        }
        const checkUrl = candidates[index]
        console.log(`Attempt ${attempt}/${retries}: checking ${checkUrl}`)
        const req = http.get(checkUrl, (res) => {
          res.resume()
          console.log(`✅ CDP endpoint ready! (${checkUrl})`)
          resolve(true)
        })
        req.setTimeout(1000, () => req.destroy(new Error("timeout")))
        req.on("error", () => tryOne(index + 1))
      }
      tryOne(0)
    }

    tryAttempt()
  })
}

function quickCheckCdp(checkUrl) {
  return new Promise((resolve) => {
    try {
      // In WSL, if checking Windows localhost, prefer calling curl.exe (Windows) for accuracy
      if (isWSL() && checkUrl.startsWith("http://localhost:")) {
        const curlCmd = resolveWindowsCurl()
        if (curlCmd) {
          const r = spawnSync(curlCmd, ["-sSf", checkUrl], { stdio: ["ignore", "ignore", "ignore"] })
          resolve(r.status === 0)
        } else {
          resolve(false)
        }
        return
      }

      const req = http.get(checkUrl, (res) => {
        res.resume()
        resolve(true)
      })
      req.on("error", () => resolve(false))
      req.setTimeout(1000, () => {
        req.destroy()
        resolve(false)
      })
    } catch {
      resolve(false)
    }
  })
}

function windowsChromeInstalled() {
  // Detect Chrome presence on Windows/WSL by checking common install paths,
  // registry App Paths, or PATH via Get-Command.
  const ps = isWSL() ? "powershell.exe" : "powershell"
  try {
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      "$paths = @('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe')",
      "foreach ($p in $paths) { if (Test-Path $p) { exit 0 } }",
      "$appPath = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe').'(Default)'",
      "if ($appPath -and (Test-Path $appPath)) { exit 0 }",
      "if (Get-Command chrome.exe) { exit 0 }",
      "exit 1"
    ].join("; ")
    const r = spawnSync(ps, ["-Command", script], { stdio: "ignore" })
    return r.status === 0
  } catch {
    return false
  }
}

async function main() {
  const { appUrl, checkUrl, cdpPort } = parseArgs()

  console.log("PWD:", process.cwd())
  console.log("CDP check URL:", checkUrl)
  if (isWSL()) {
    console.log("WSL fallback check URL: http://localhost:9222/json/version")
  }

  // If a CDP endpoint is already up, skip installation/launch.
  let cdpReady = await quickCheckCdp(checkUrl)
  // In WSL, Chrome may bind only to Windows localhost. Probe via PowerShell as a fallback.
  if (!cdpReady && isWSL()) {
    try {
      const ps = "powershell.exe"
      const probe = spawnSync(
        ps,
        [
          "-Command",
          "$progressPreference='silentlyContinue'; try { (Invoke-WebRequest -UseBasicParsing http://localhost:9222/json/version -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }"
        ],
        { stdio: "ignore" }
      )
      cdpReady = probe.status === 0
    } catch {
      // ignore
    }
  }

  if (cdpReady) {
    console.log("✅ Detected running Chrome CDP endpoint. Skipping launch/install.")
    return
  }

  const _args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${process.platform === "win32" || isWSL() ? "C:/temp/chrome-dev-profile" : "/tmp/chrome-dev-profile"}`,
    "--no-first-run",
    "--no-default-browser-check",
    appUrl
  ]

  if (isWSL()) {
    // Launch Windows Chrome from WSL (or install it if missing)
    // Check if Chrome exists (robust checks beyond PATH)
    const chromeExists = windowsChromeInstalled()
    if (!chromeExists) {
      console.log("Chrome not found on Windows (from WSL).")
      const allowed = await confirmInstall(
        "Attempt to install Chrome using winget/choco with administrator privileges (Windows)?"
      )
      if (!allowed) {
        console.log("Install Chrome manually and re-run dev-up.")
        console.log("winget install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements")
        console.log("choco install googlechrome -y")
        process.exit(1)
      }
      const ok = await ensureChromeInstalledWindowsLike()
      if (!ok) process.exit(1)
    }
    const psCmd = [
      "Start-Process",
      "chrome.exe",
      "-ArgumentList",
      `'--remote-debugging-port=${cdpPort}','--remote-debugging-address=0.0.0.0','--user-data-dir=C:\\temp\\chrome-dev-profile','--no-first-run','--no-default-browser-check','${appUrl}'`
    ].join(" ")
    console.log("Detected WSL environment")
    console.log("Running (powershell):", psCmd)
    const ps = spawn("powershell.exe", ["-Command", psCmd], { stdio: "ignore" })
    ps.on("error", () => {
      const cmdLine = [
        "start",
        "chrome.exe",
        `--remote-debugging-port=${cdpPort}`,
        "--remote-debugging-address=0.0.0.0",
        "--user-data-dir=C:\\temp\\chrome-dev-profile",
        "--no-first-run",
        "--no-default-browser-check",
        appUrl
      ]
      console.log("Running (cmd.exe):", cmdLine.join(" "))
      spawn("cmd.exe", ["/c", ...cmdLine], { stdio: "ignore" })
    })
  } else if (process.platform === "win32") {
    // Native Windows (or install it if missing)
    const chromeExists = windowsChromeInstalled()
    if (!chromeExists) {
      console.log("Chrome not found on Windows.")
      const allowed = await confirmInstall(
        "Attempt to install Chrome using winget/choco with administrator privileges (Windows)?"
      )
      if (!allowed) {
        console.log("Install Chrome manually and re-run dev-up.")
        console.log("winget install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements")
        console.log("choco install googlechrome -y")
        process.exit(1)
      }
      const ok = await ensureChromeInstalledWindowsLike()
      if (!ok) process.exit(1)
    }
    const psCmd = [
      "Start-Process",
      "chrome.exe",
      "-ArgumentList",
      `'--remote-debugging-port=${cdpPort}','--user-data-dir=C:\\temp\\chrome-dev-profile','--no-first-run','--no-default-browser-check','${appUrl}'`
    ].join(" ")
    console.log("Detected Windows environment")
    console.log("Running (powershell):", psCmd)
    const ps = spawn("powershell.exe", ["-Command", psCmd], { stdio: "ignore" })
    ps.on("error", () => {
      const cmdLine = [
        "start",
        "chrome.exe",
        `--remote-debugging-port=${cdpPort}`,
        "--user-data-dir=C:\\temp\\chrome-dev-profile",
        "--no-first-run",
        "--no-default-browser-check",
        appUrl
      ]
      console.log("Running (cmd.exe):", cmdLine.join(" "))
      spawn("cmd.exe", ["/c", ...cmdLine], { stdio: "ignore" })
    })
  } else if (process.platform === "darwin") {
    // macOS
    // Verify presence by trying to run 'open -a Google Chrome --version'
    const hasChrome = runSyncOk("open", ["-a", "Google Chrome", "--args", "--version"])
    if (!hasChrome) {
      console.log("Chrome not found on macOS.")
      const allowed = await confirmInstall("Attempt to install Chrome via Homebrew cask (macOS)?")
      if (!allowed) {
        console.log("Install Chrome manually and re-run dev-up.")
        console.log("brew install --cask google-chrome")
        console.log("or download from https://www.google.com/chrome/")
        process.exit(1)
      }
      const ok = await ensureChromeInstalledMac()
      if (!ok) process.exit(1)
    }
    const openArgs = [
      "-a",
      "Google Chrome",
      "--args",
      `--remote-debugging-port=${cdpPort}`,
      "--user-data-dir=/tmp/chrome-dev-profile",
      "--no-first-run",
      "--no-default-browser-check",
      appUrl
    ]
    console.log("Detected macOS environment")
    console.log("Running:", "open", openArgs.join(" "))
    spawn("open", openArgs, { stdio: "ignore" })
  } else {
    // Linux
    let chromeBin = null
    for (const candidate of ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]) {
      if (which(candidate)) {
        chromeBin = candidate
        break
      }
    }
    if (!chromeBin) {
      console.log("Chrome/Chromium binary not found on Linux.")
      const allowed = await confirmInstall("Attempt to install Chromium/Chrome via your package manager (Linux)?")
      if (!allowed) {
        console.log("Install chromium/google-chrome manually and re-run dev-up.")
        console.log("Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y chromium-browser")
        console.log("Fedora:        sudo dnf install -y chromium")
        console.log("Arch:          sudo pacman -Sy --noconfirm chromium")
        process.exit(1)
      }
      const ok = await ensureChromeInstalledLinux()
      if (!ok) process.exit(1)
      for (const candidate of ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]) {
        if (which(candidate)) {
          chromeBin = candidate
          break
        }
      }
      if (!chromeBin) {
        console.error("❌ No Chrome/Chromium binary found even after install attempt")
        process.exit(1)
      }
    }
    const chromeArgs = [
      `--remote-debugging-port=${cdpPort}`,
      "--user-data-dir=/tmp/chrome-dev-profile",
      "--no-first-run",
      "--no-default-browser-check",
      appUrl
    ]
    console.log("Detected Linux environment")
    console.log("Running:", chromeBin, chromeArgs.join(" "))
    spawn(chromeBin, chromeArgs, { stdio: "ignore", detached: true })
  }

  try {
    const list = isWSL() ? ["http://localhost:9222/json/version", checkUrl] : [checkUrl]
    const candidates = Array.from(new Set(list))
    // Try fast path via curl.exe first when targeting Windows localhost
    if (isWSL() && candidates[0].startsWith("http://localhost:")) {
      const curlCmd = resolveWindowsCurl()
      const r = curlCmd
        ? spawnSync(curlCmd, ["-sSf", candidates[0]], { stdio: ["ignore", "ignore", "ignore"] })
        : { status: 1 }
      if (r.status === 0) {
        console.log(`✅ CDP endpoint ready! (${candidates[0]})`)
      } else {
        await waitForAnyCdp(candidates)
      }
    } else {
      await waitForAnyCdp(candidates)
    }
  } catch {
    // Let caller decide next steps; we logged guidance
  }
}

main().catch((e) => {
  console.error("❌ Failed to launch Chrome with CDP:", e.message)
  process.exit(1)
})

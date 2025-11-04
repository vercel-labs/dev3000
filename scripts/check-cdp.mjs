#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const URL = process.env.CDP_URL || "http://localhost:9222/json/version"
const HOME_DIR = os.homedir()

let hostSessionsHaveCdp = false
let hostSessionCount = 0
let containerSessionsHaveCdp = false
let containerSessionCount = 0

// -------- helpers --------
function section(title) {
  console.log(`\n===== ${title} =====`)
}
function kv(key, value) {
  console.log(`- ${key}: ${value}`)
}
function run(name, cmd, args, opts = {}) {
  const t0 = Date.now()
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts })
  const took = Date.now() - t0
  const code = r.status ?? 1
  const out = (r.stdout || "").trim()
  const err = (r.stderr || "").trim()
  return { name, cmd, args, code, out, err, took }
}
function printRunResult(rr, { showOutSnippet = true } = {}) {
  kv("Command", [rr.cmd, ...rr.args].join(" "))
  kv("Exit", rr.code)
  kv("Time(ms)", rr.took)
  if (showOutSnippet) {
    const snippet = rr.out.length > 300 ? `${rr.out.slice(0, 300)}...` : rr.out
    kv("Stdout", snippet || "<empty>")
  }
  if (rr.err) {
    const esnippet = rr.err.length > 300 ? `${rr.err.slice(0, 300)}...` : rr.err
    kv("Stderr", esnippet)
  }
}
function resolveWindowsCurl() {
  // Prefer curl.exe on PATH, then %WINDIR%\System32\curl.exe
  let candidate = null
  try {
    const r = spawnSync("curl.exe", ["--version"], { stdio: "ignore" })
    if (r.status === 0) candidate = "curl.exe"
  } catch {}
  if (!candidate && process.env.WINDIR) {
    const p = `${process.env.WINDIR}\\System32\\curl.exe`
    try {
      const r2 = spawnSync(p, ["--version"], { stdio: "ignore" })
      if (r2.status === 0) candidate = p
    } catch {}
  }
  return candidate
}
function tryParseBrowser(s) {
  try {
    const j = JSON.parse(s)
    return j.Browser || ""
  } catch {
    return ""
  }
}

// -------- Environment --------
section("Environment")
kv("CWD", process.cwd())
kv("Node", process.version)
kv("Platform", os.platform())
kv("Release", os.release())
const IS_WSL = /microsoft/i.test(os.release()) || !!process.env.WSL_INTEROP || !!process.env.WSLENV
kv("WSL", IS_WSL)
kv("Target URL", URL)

// -------- Host: baseline reachability --------
section("Host baseline")
// ping localhost & 127.0.0.1 (may require CAP_NET_RAW; ignore failures)
const havePing = spawnSync("which", ["ping"], { encoding: "utf8" }).status === 0
if (havePing) {
  const pingLocal = run("ping localhost", "bash", ["-lc", "ping -c 1 -W 1 localhost || true"]) 
  printRunResult(pingLocal)
  const ping127 = run("ping 127.0.0.1", "bash", ["-lc", "ping -c 1 -W 1 127.0.0.1 || true"]) 
  printRunResult(ping127)
} else {
  kv("ping", "not found; skipped")
}

// WSL/Linux curl to CDP
section("Host WSL/Linux curl")
const wslCurl = run("wsl curl", "curl", ["-sSf", URL])
printRunResult(wslCurl)
if (wslCurl.code === 0) kv("Browser", tryParseBrowser(wslCurl.out))

// Linux listener check (likely empty when bound on Windows)
const ssOut = run("linux ss", "bash", ["-lc", "ss -ltnp 2>/dev/null | grep ':9222' || true"]) 
printRunResult(ssOut, { showOutSnippet: true })

// -------- Windows-side reachability (from WSL) --------
section("Windows reachability (via interop)")
const curlExe = resolveWindowsCurl()
if (curlExe) {
  const hostCurl = run("win curl.exe", curlExe, ["-sSf", URL])
  printRunResult(hostCurl)
  if (hostCurl.code === 0) kv("Browser", tryParseBrowser(hostCurl.out))
} else {
  kv("curl.exe", "not found")
}

const psWget = run(
  "powershell IWR",
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; try { (Invoke-WebRequest -UseBasicParsing ${URL} -TimeoutSec 2) | Out-Null; Write-Output 200; exit 0 } catch { Write-Output ERR; exit 1 }`
  ]
)
printRunResult(psWget)

const psTcp = run(
  "powershell TCP",
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-NetTCPConnection -LocalPort 9222 | Select-Object LocalAddress,State,OwningProcess | ConvertTo-Json -Compress"
  ]
)
printRunResult(psTcp)

if (IS_WSL) {
  section("Windows portproxy / firewall quick check")
  const portProxy = run(
    "netsh portproxy",
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "netsh interface portproxy show v4tov4"
    ]
  )
  printRunResult(portProxy)

  const fwRule = run(
    "firewall 9222",
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "try { Get-NetFirewallRule -PolicyStore ActiveStore | Where-Object { $_.DisplayName -match '9222' } | Select-Object -Property DisplayName,Enabled,Direction,Action | ConvertTo-Json -Compress } catch { Write-Output 'ERR'; exit 1 }"
    ]
  )
  printRunResult(fwRule)
}

// -------- Dev3000 MCP API reachability --------
section("Dev3000 MCP API (port 3684)")
const wslDev3000 = run("wsl curl dev3000", "curl", ["-sS", "http://localhost:3684/api/orchestrator"])
printRunResult(wslDev3000)

if (curlExe) {
  const winDev3000 = run("win curl.exe dev3000", curlExe, ["-sS", "http://localhost:3684/api/orchestrator"])
  printRunResult(winDev3000)
}

// -------- Docker-side reachability --------
section("Docker reachability")
const dockerUp = run("docker ps", "bash", [
  "-lc",
  "docker ps --format '{{.Names}}' | grep -q '^dev3000$' && echo up || echo down"
])
printRunResult(dockerUp)
let dxMcpPsOut = ""
if (/up/.test(dockerUp.out)) {
  const dxWhichCurl = run(
    "dx which curl",
    "bash",
    ["-lc", "docker exec dev3000 sh -lc 'which curl || true'"]
  )
  printRunResult(dxWhichCurl)

  const dxPing = run(
    "dx ping host.docker.internal",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'command -v ping >/dev/null 2>&1 && ping -c 1 -W 1 host.docker.internal || echo ping-not-available'"
    ]
  )
  printRunResult(dxPing)

  const dxCurlLocal = run(
    "dx curl localhost:9222 (socat?)",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'curl -sSf http://localhost:9222/json/version || true'"
    ]
  )
  printRunResult(dxCurlLocal)
  if (dxCurlLocal.out) kv("Browser(local)", tryParseBrowser(dxCurlLocal.out))

  const dxCurlHost = run(
    "dx curl host.docker.internal:9222",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'curl -sSf http://host.docker.internal:9222/json/version || true'"
    ]
  )
  printRunResult(dxCurlHost)
  if (dxCurlHost.out) kv("Browser(host)", tryParseBrowser(dxCurlHost.out))

  const dxHosts = run(
    "dx hosts lookup",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'getent hosts host.docker.internal 2>/dev/null || getent hosts gateway.docker.internal 2>/dev/null || true'"
    ]
  )
  printRunResult(dxHosts)

  const dxEnv = run(
    "dx env DEV3000_CDP_URL",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'echo DEV3000_CDP_URL=$DEV3000_CDP_URL'"
    ]
  )
  printRunResult(dxEnv)

  const dxSession = run(
    "dx session file",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'cat /root/.d3k/*.json 2>/dev/null || echo no-session'"
    ]
  )
  printRunResult(dxSession)
  const dxSessionOut = dxSession.out.trim()
  if (dxSessionOut && dxSessionOut !== "no-session") {
    const cdpMatches = dxSessionOut.match(/"cdpUrl":\s*"([^"]*)"/g)
    const nullMatches = dxSessionOut.match(/"cdpUrl": null/g)
    if (cdpMatches) {
      containerSessionCount = cdpMatches.length
      containerSessionsHaveCdp = cdpMatches.some((entry) => !entry.includes('"cdpUrl":"null"') && !entry.endsWith('""'))
    } else if (nullMatches) {
      containerSessionCount = nullMatches.length
      containerSessionsHaveCdp = false
    }
  }

  const dxMcpPs = run(
    "dx mcp processes",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'ps -eo pid,args | grep -E \"(chrome-devtools-mcp|next-devtools-mcp)\" | grep -v grep || echo none'"
    ]
  )
  printRunResult(dxMcpPs)
  dxMcpPsOut = dxMcpPs.out

  const dxOrchestrator = run(
    "dx orchestrator api",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'curl -sSf http://localhost:3684/api/orchestrator || true'"
    ]
  )
  printRunResult(dxOrchestrator)

  const dxToolsApi = run(
    "dx tools api",
    "bash",
    [
      "-lc",
      "docker exec dev3000 sh -lc 'curl -sSf http://localhost:3684/api/tools || true'"
    ]
  )
  printRunResult(dxToolsApi)
} else {
  kv("dev3000", "not running; skipped container checks")
}

// -------- Session files on host --------
section("Host ~/.d3k session files")
try {
  const sessionDir = path.join(HOME_DIR, ".d3k")
  if (!existsSync(sessionDir)) {
    kv("sessions", "~/.d3k not found")
  } else {
    const files = readdirSync(sessionDir).filter((f) => f.endsWith(".json"))
    hostSessionCount = files.length
    if (files.length === 0) {
      kv("sessions", "no session json files")
    } else {
      for (const file of files) {
        try {
          const raw = readFileSync(path.join(sessionDir, file), "utf8")
          const data = JSON.parse(raw)
          if (typeof data.cdpUrl === "string" && data.cdpUrl.length > 0) {
            hostSessionsHaveCdp = true
          }
          kv(
            file,
            `appPort=${data.appPort ?? "?"}, mcpPort=${data.mcpPort ?? "?"}, cdpUrl=${data.cdpUrl ?? "null"}, start=${data.startTime ?? "?"}`
          )
        } catch (error) {
          kv(file, `parse error: ${(error instanceof Error ? error.message : String(error)).slice(0, 160)}`)
        }
      }
    }
  }
} catch (error) {
  kv("sessions", `error reading ~/.d3k: ${error instanceof Error ? error.message : String(error)}`)
}

// -------- Summary --------
section("Summary")
const winOK = (() => {
  if (!curlExe) return false
  const t = run("win curl.exe", curlExe, ["-sSf", URL])
  return t.code === 0
})()
const wslOK = wslCurl.code === 0
kv("Windows curl.exe", winOK ? "OK" : "NG")
kv("WSL curl", wslOK ? "OK" : "NG")
if (/up/.test(dockerUp.out)) kv("Docker", "see Docker reachability section")

const dxChromeDevtoolsRunning = /chrome-devtools-mcp/.test(dxMcpPsOut)
kv(
  "Host sessions",
  hostSessionCount === 0
    ? "none (dev3000 runs in container by default)"
    : `${hostSessionCount} file(s)${hostSessionsHaveCdp ? " (cdpUrl detected)" : " (no cdpUrl)"}`
)
if (/up/.test(dockerUp.out)) {
  kv(
    "Container sessions",
    containerSessionCount === 0
      ? "none"
      : `${containerSessionCount} entry(ies)${containerSessionsHaveCdp ? " (cdpUrl detected)" : " (no cdpUrl)"}`
  )
}

section("Hints")
console.log("- Windows OK / WSL NG の場合は、Chrome が Windows の loopback のみにバインドされています。")
console.log("- 対策案:")
console.log("  * Chrome 起動時に --remote-debugging-address=0.0.0.0 を付与 (既に付与済みならFW/ポリシーを要確認)")
console.log("  * 管理者 PowerShell でポートプロキシ:")
console.log(
  "    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=9222 connectaddress=127.0.0.1 connectport=9222"
)
console.log("  * Windows ファイアウォールで TCP 9222 を許可 (プライベート ネットワーク)")
if (/up/.test(dockerUp.out)) {
  if (!containerSessionsHaveCdp) {
    console.log("- コンテナ内の /root/.d3k セッションに cdpUrl が見つかりません。Chrome が起動しているか、DEV3000_CDP_URL が正しいか確認してください。")
  }
} else if (!hostSessionsHaveCdp) {
  console.log("- ~/.d3k に cdpUrl が記録されていません。dev3000 をホストで実行していない場合は正常です。")
}
if (/up/.test(dockerUp.out) && !dxChromeDevtoolsRunning) {
  console.log("- コンテナ内で chrome-devtools-mcp プロセスが検出できません。bunx が存在するか、DEV3000_CDP_URL が正しいかを確認してください。")
}

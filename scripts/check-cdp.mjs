#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import os from "node:os"

const URL = process.env.CDP_URL || "http://localhost:9222/json/version"

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

// -------- Docker-side reachability --------
section("Docker reachability")
const dockerUp = run("docker ps", "bash", [
  "-lc",
  "docker ps --format '{{.Names}}' | grep -q '^dev3000$' && echo up || echo down"
])
printRunResult(dockerUp)
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
} else {
  kv("dev3000", "not running; skipped container checks")
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

section("Hints")
console.log("- Windows OK / WSL NG の場合は、Chrome が Windows の loopback のみにバインドされています。")
console.log("- 対策案:")
console.log("  * Chrome 起動時に --remote-debugging-address=0.0.0.0 を付与 (既に付与済みならFW/ポリシーを要確認)")
console.log("  * 管理者 PowerShell でポートプロキシ:")
console.log(
  "    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=9222 connectaddress=127.0.0.1 connectport=9222"
)
console.log("  * Windows ファイアウォールで TCP 9222 を許可 (プライベート ネットワーク)")

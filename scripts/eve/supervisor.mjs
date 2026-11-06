import { spawn } from "node:child_process"

// Run inside the existing isolated VM. Bound the Eve session independently of the laptop.
const expiresAt = Number(process.env.D3K_EVE_EXPIRES_AT)
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Eve session access has expired")
const child = spawn(
  process.execPath,
  ["node_modules/eve/bin/eve.js", "start", "--host", "0.0.0.0", "--port", process.env.D3K_EVE_PORT, "--no-schedules"],
  { detached: true, stdio: "inherit" }
)
let stopping = false
let force
function signalGroup(signal) {
  if (!child.pid) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}
function stop() {
  if (stopping) return
  stopping = true
  signalGroup("SIGTERM")
  force = setTimeout(() => signalGroup("SIGKILL"), 2000)
}
const deadline = setTimeout(stop, expiresAt - Date.now())
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
child.on("error", (error) => {
  console.error(error.message)
  clearTimeout(deadline)
  process.exitCode = 1
})
child.on("exit", (code) => {
  // Ensure descendants cannot outlive the bounded service supervisor.
  signalGroup("SIGKILL")
  clearTimeout(deadline)
  clearTimeout(force)
  process.exitCode = stopping ? 0 : (code ?? 1)
})

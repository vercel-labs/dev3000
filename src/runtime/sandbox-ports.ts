// Keep infrastructure off the app's conventional port, including during startup checks.
export const SANDBOX_APP_PORT = 3000
export const SANDBOX_PROXY_PORT = 9224
export const SANDBOX_BRIDGE_PORT = 9223

/** Port 3000 must stay private: only the authenticated proxy is exposed by Sandbox. */
export function sandboxExposedPorts(existing: number[] = []): number[] {
  return [
    ...new Set([...existing.filter((port) => port !== SANDBOX_APP_PORT), SANDBOX_PROXY_PORT, SANDBOX_BRIDGE_PORT])
  ]
}

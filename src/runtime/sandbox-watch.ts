import { setTimeout as delay } from "node:timers/promises"

/** A failed API request is not evidence that a remote process exited. */
export async function watchSandboxRuntime(options: {
  status: (signal: AbortSignal) => Promise<{ exitCode: number | null }>
  signal: AbortSignal
  onExit: (code: number) => void
  log: (message: string) => void
  intervalMs?: number
}): Promise<void> {
  let disconnected = false
  while (!options.signal.aborted) {
    try {
      const state = await options.status(AbortSignal.any([options.signal, AbortSignal.timeout(10000)]))
      if (options.signal.aborted) return
      if (disconnected) options.log("Remote runtime monitoring reconnected")
      disconnected = false
      if (state.exitCode !== null) {
        options.onExit(state.exitCode)
        return
      }
    } catch {
      if (options.signal.aborted) return
      if (!disconnected) options.log("Remote runtime status unavailable; retrying without interrupting the shell")
      disconnected = true
    }
    await delay(options.intervalMs ?? (disconnected ? 15000 : 5000), undefined, {
      signal: options.signal
    }).catch(() => {})
  }
}

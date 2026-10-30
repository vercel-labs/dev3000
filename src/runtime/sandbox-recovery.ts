import type { WorkspaceResult } from "./sandbox-workspace.js"

/** Recovery is explicit and asynchronous: never replay an agent command or block MCP ping. */
export function sandboxRecovery(recover: () => Promise<unknown>, signal: AbortSignal) {
  let state: { phase: "idle" | "recovering" | "recovered" | "failed"; result?: unknown; error?: string } = {
    phase: "idle"
  }
  let pending: Promise<void> | undefined
  return async (args: Record<string, unknown>): Promise<WorkspaceResult> => {
    const action = args.action ?? "start"
    if (!["start", "status"].includes(String(action)) || Object.keys(args).some((key) => key !== "action"))
      throw new Error("Use action start or status")
    if (signal.aborted) throw new Error("Session ended; resume the sandbox")
    if (action === "start" && !pending) {
      state = { phase: "recovering" }
      pending = Promise.resolve()
        .then(() => {
          if (signal.aborted) throw new Error("Session ended")
          return recover()
        })
        .then(
          (result) => {
            state = { phase: "recovered", result }
          },
          (error: unknown) => {
            state = { phase: "failed", error: error instanceof Error ? error.message : "Recovery failed" }
          }
        )
        .finally(() => {
          pending = undefined
        })
    }
    return {
      content: [{ type: "text", text: JSON.stringify(state) }],
      ...(state.phase === "failed" ? { isError: true } : {})
    }
  }
}

import { createInterface } from "node:readline/promises"

export async function waitToReconnect({ signal, onInterrupt, input = process.stdin, output = process.stdout }) {
  const closed = new AbortController()
  const menu = createInterface({ input, output })
  menu.on("SIGINT", () => {
    closed.abort()
    onInterrupt?.()
  })
  menu.on("close", () => closed.abort())
  try {
    await menu.question("Agent remains remote. Enter to reconnect; Ctrl-C to exit: ", {
      signal: signal ? AbortSignal.any([signal, closed.signal]) : closed.signal
    })
    return true
  } catch (error) {
    if (error.name !== "AbortError") throw error
    return false
  } finally {
    menu.close()
  }
}

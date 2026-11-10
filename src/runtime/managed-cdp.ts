type Data = Record<string, unknown>
export type BrowserInvoke = (args: string[]) => Promise<string>
export interface ManagedCdp {
  send: (method: string, params?: Data) => Promise<Data>
  close: () => void
}

function commandData(output: string): Data {
  const result = JSON.parse(output) as { success?: boolean; data?: Data; error?: string }
  if (!result.success || !result.data) throw new Error(result.error || "Managed browser command failed")
  return result.data
}

/** Auxiliary connection to the active runtime-owned target; never launches a browser. */
export async function connectManagedCdp(invoke: BrowserInvoke): Promise<ManagedCdp> {
  const connection = commandData(await invoke(["get", "cdp-url", "--json"]))
  const tabs = commandData(await invoke(["tab", "list", "--json"]))
  const active = (tabs.tabs as Array<{ active: boolean; targetId: string }>).find((tab) => tab.active)
  if (!active?.targetId || typeof connection.cdpUrl !== "string") throw new Error("No active managed browser target")
  const ws = new WebSocket(connection.cdpUrl)
  let nextId = 0
  let sessionId: string | undefined
  const pending = new Map<number, { reject: (error: Error) => void; resolve: (data: Data) => void }>()
  const closed = () => {
    for (const request of pending.values()) request.reject(new Error("Capture browser connection closed"))
    pending.clear()
  }
  ws.addEventListener("close", closed)
  ws.addEventListener("error", closed)
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: Data; error?: { message: string } }
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result || {})
  })
  async function send(method: string, params: Data = {}): Promise<Data> {
    if (ws.readyState !== WebSocket.OPEN) throw new Error("Capture browser connection is not open")
    const id = ++nextId
    const response = new Promise<Data>((resolve, reject) => pending.set(id, { resolve, reject }))
    const timer = setTimeout(() => {
      pending.get(id)?.reject(new Error(`Capture CDP timeout: ${method}`))
      pending.delete(id)
    }, 15000)
    try {
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      return await response
    } finally {
      clearTimeout(timer)
      pending.delete(id)
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error("Capture CDP connection timed out"))
      }, 10000)
      ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer)
          reject(new Error("Capture CDP connection failed"))
        },
        { once: true }
      )
    })
    const attached = await send("Target.attachToTarget", { targetId: active.targetId, flatten: true })
    sessionId = String(attached.sessionId)
    return { send, close: () => ws.close() }
  } catch (error) {
    ws.close()
    throw error
  }
}

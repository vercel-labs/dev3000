import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { test } from "vitest"
import { waitToReconnect } from "./reconnect.mjs"

for (const action of ["enter", "ctrl-c", "signal", "expired", "eof"]) {
  test(`reconnect prompt handles ${action}`, async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    input.isTTY = true
    input.setRawMode = () => input
    output.isTTY = true
    output.columns = 100
    let displayed = ""
    output.on("data", (chunk) => {
      displayed += chunk
    })
    const shutdown = new AbortController()
    if (action === "expired") shutdown.abort()
    let interrupted = false
    const result = waitToReconnect({
      input,
      output,
      signal: shutdown.signal,
      onInterrupt: () => {
        interrupted = true
        shutdown.abort()
      }
    })
    if (action === "enter") input.write("\r")
    if (action === "ctrl-c") input.write("\x03")
    if (action === "signal") shutdown.abort()
    if (action === "eof") input.end()
    assert.equal(await result, action === "enter")
    assert.equal(interrupted, action === "ctrl-c")
    if (action === "expired") assert.equal(displayed, "")
    else assert.match(displayed, /Ctrl-C to exit/)
    input.destroy()
    output.destroy()
  })
}

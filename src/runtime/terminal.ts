import type { Readable, Writable } from "node:stream"
import { setImmediate as nextTurn } from "node:timers/promises"

export interface TerminalInput extends Readable {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (raw: boolean) => unknown
  unref?: () => unknown
}
interface TerminalOutput extends Writable {
  isTTY?: boolean
}

// Pop Kitty keyboard state, disable enhanced keys/modifyOtherKeys, and leave
// the shell with ordinary input, mouse tracking off, and a visible cursor.
export const TERMINAL_RESET =
  "\x1b[<u\x1b[=0u\x1b[>4;0m\x1b[?2004l\x1b[?1004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[0m\x1b[?25h"

/** A child can change terminal modes even though the parent's isRaw stays false. */
export function terminalRestorer(input: TerminalInput = process.stdin, output: TerminalOutput = process.stdout) {
  const wasRaw = input.isRaw ?? false
  return () => {
    if (!input.isTTY) return
    try {
      if (output.isTTY) output.write(TERMINAL_RESET)
      input.setRawMode?.(wasRaw)
    } catch {
      // Closing the terminal must not prevent browser/sandbox cleanup.
    }
  }
}

/** Own stdin until cleanup finishes; late Ctrl-C/report packets must not reach zsh. */
export function holdTerminalForCleanup(input: TerminalInput = process.stdin, output: TerminalOutput = process.stdout) {
  const restore = terminalRestorer(input, output)
  if (!input.isTTY) return () => {}
  const wasFlowing = input.readableFlowing === true
  restore()
  const discard = () => {}
  try {
    input.setRawMode?.(true)
    input.on("data", discard)
    input.resume()
  } catch {
    input.off("data", discard)
    restore()
    return () => {}
  }
  return () => {
    input.off("data", discard)
    restore()
    if (!wasFlowing) {
      input.pause()
      input.unref?.()
    }
  }
}

/** Print durable shell instructions only after terminal restoration and queued signals settle. */
export async function finishTerminalCleanup(
  release: () => void,
  message?: string,
  output: TerminalOutput = process.stdout
): Promise<void> {
  release()
  if (!message) return
  await nextTurn()
  await new Promise<void>((resolve, reject) => {
    output.write(`${message}\n`, (error) => (error ? reject(error) : resolve()))
  })
}

import { execFile } from "node:child_process"
import { PassThrough, Writable } from "node:stream"
import { promisify } from "node:util"
import { describe, expect, it, vi } from "vitest"
import { finishTerminalCleanup, holdTerminalForCleanup, TERMINAL_RESET, terminalRestorer } from "./terminal.js"

function terminal(raw = false) {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: raw, setRawMode: vi.fn(), unref: vi.fn() })
  const output = Object.assign(new PassThrough(), { isTTY: true })
  return { input, output }
}

describe("terminal handoff", () => {
  it("restores enhanced keyboard modes and the original raw state after a harness exits", () => {
    const { input, output } = terminal()
    const restore = terminalRestorer(input, output)
    input.isRaw = true
    restore()
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
    expect(output.read().toString()).toBe(TERMINAL_RESET)
  })

  it("consumes repeated Ctrl-C and keyboard reports until cleanup completes", async () => {
    const { input, output } = terminal()
    const release = holdTerminalForCleanup(input, output)
    input.write(Buffer.from("\x1b[99;5u\x03\x1b[99;5u\x03"))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(input.read()).toBeNull()
    release()
    expect(input.listenerCount("data")).toBe(0)
    expect(input.isPaused()).toBe(true)
    expect(input.unref).toHaveBeenCalledOnce()
    expect(input.setRawMode.mock.calls.map(([raw]) => raw)).toEqual([false, true, false])
  })

  it("preserves an already raw terminal and leaves redirected output alone", () => {
    const { input, output } = terminal(true)
    output.isTTY = false
    terminalRestorer(input, output)()
    expect(input.setRawMode).toHaveBeenCalledWith(true)
    expect(output.read()).toBeNull()
  })

  it("does not consume piped input or emit terminal controls outside a TTY", () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const release = holdTerminalForCleanup(input, output)
    input.write("keep me")
    release()
    expect(input.read().toString()).toBe("keep me")
    expect(output.read()).toBeNull()
  })

  it("restores the terminal before the resume line and waits for the output callback", async () => {
    const release = vi.fn()
    let flushed: (() => void) | undefined
    let written = ""
    const output = new Writable({
      write(chunk, _encoding, callback) {
        expect(release).toHaveBeenCalledOnce()
        written += chunk.toString()
        flushed = callback
      }
    })
    let finished = false
    const completion = finishTerminalCleanup(release, "Resume this sandbox: d3k --resume saved-id", output).then(() => {
      finished = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(written).toBe("Resume this sandbox: d3k --resume saved-id\n")
    expect(finished).toBe(false)
    flushed?.()
    await completion
    expect(finished).toBe(true)
  })

  it("restores without emitting human output for an MCP connection", async () => {
    const release = vi.fn()
    const output = new PassThrough()
    await finishTerminalCleanup(release, undefined, output)
    expect(release).toHaveBeenCalledOnce()
    expect(output.read()).toBeNull()
  })

  it("clears a stale TUI row so the resume command has no old prefix or suffix", async () => {
    const { output } = terminal()
    const message = "Resume this sandbox: d3k --resume e55ea06a-a4fd-4337-b220-604d6755153b"
    await finishTerminalCleanup(() => {}, message, output)
    // Model terminal row writes: CR moves the cursor, erase-line clears the row,
    // and ordinary characters overwrite rather than truncate existing contents.
    let row = [..."Old agent transcript ".repeat(8), ..."Hub route and open a draft PR;"]
    let column = 17
    const lines: string[] = []
    for (const token of output
      .read()
      .toString()
      .match(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]|[\\s\\S]`, "g")) || []) {
      if (token === "\r") column = 0
      else if (token === "\x1b[2K") row = []
      else if (token === "\n") {
        lines.push(row.join(""))
        row = []
      } else row[column++] = token
    }
    expect(lines).toEqual([message])
    expect(column).toBe(0)
  })

  it.skipIf(process.platform === "win32")(
    "leaves a complete resume command after Node PTY restoration",
    async () => {
      const terminal = new URL("./terminal.ts", import.meta.url).href
      const resume = "Resume this sandbox: d3k --resume 00000000-0000-4000-8000-000000000000"
      const fixture = `
      import { holdTerminalForCleanup, finishTerminalCleanup, terminalRestorer } from ${JSON.stringify(terminal)};
      const ignore = () => {};
      process.on('SIGINT', ignore);
      const restore = terminalRestorer();
      process.stdin.setRawMode(true);
      process.stdout.write('\\x1b[>1u');
      restore();
      const release = holdTerminalForCleanup();
      process.stderr.write('CLEANUP_READY\\n');
      await new Promise(resolve => setTimeout(resolve, 200));
      await finishTerminalCleanup(() => {
        release();
        process.kill(process.pid, 'SIGINT');
      }, ${JSON.stringify(resume)});
      process.off('SIGINT', ignore);
    `
      const python = `
import os, pty, select, signal, subprocess, sys, termios, time
master, slave = pty.openpty()
initial = termios.tcgetattr(slave)
child = subprocess.Popen(['node', '--input-type=module', '-e', sys.argv[1]], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
output = b''
sent = False
try:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if select.select([master], [], [], .02)[0]:
            output += os.read(master, 65536)
        if b'CLEANUP_READY' in output and not sent:
            os.write(master, b'\\x1b[99;5u\\x03' * 10)
            os.kill(child.pid, signal.SIGINT)
            sent = True
        if child.poll() is not None:
            while select.select([master], [], [], .02)[0]:
                output += os.read(master, 65536)
            break
    assert child.poll() == 0 and sent, repr(output)
    resume = sys.argv[2].encode()
    assert output.replace(b'\\r\\r\\n', b'\\r\\n').endswith(resume + b'\\r\\n'), repr(output)
    assert output.rfind(b'\\x1b[=0u') < output.index(resume), repr(output)
    assert b'99;5u' not in output, repr(output)
    restored = termios.tcgetattr(slave)
    mask = termios.ECHO | termios.ICANON | termios.ISIG
    assert restored[3] & mask == initial[3] & mask, (initial, restored)
    print('PTY: full resume line survives terminal restoration and repeated interrupts')
finally:
    if child.poll() is None: child.kill()
    child.wait()
    os.close(master)
    os.close(slave)
`
      const { stdout } = await promisify(execFile)("python3", ["-c", python, fixture, resume], { timeout: 7000 })
      expect(stdout).toContain("full resume line survives")
    },
    10000
  )

  it.skipIf(process.platform === "win32")(
    "restores a real PTY after an fx-like child leaves raw/Kitty modes enabled",
    async () => {
      const harness = new URL("./harness.ts", import.meta.url).href
      const terminal = new URL("./terminal.ts", import.meta.url).href
      const fixture = `
      import { runHarnessProcess } from ${JSON.stringify(harness)};
      import { holdTerminalForCleanup } from ${JSON.stringify(terminal)};
      await runHarnessProcess('bun', ['-e', 'process.stdin.setRawMode(true); process.stdout.write("\\x1b[>1u"); process.exit(0)'], { cwd: process.cwd(), signal: new AbortController().signal });
      const release = holdTerminalForCleanup();
      process.stdout.write('CLEANUP_READY\\n');
      await new Promise(resolve => setTimeout(resolve, 300));
      release();
      process.stdout.write('DONE\\n');
    `
      const python = `
import os, pty, select, subprocess, sys, termios, time
master, slave = pty.openpty()
initial = termios.tcgetattr(slave)
child = subprocess.Popen(['bun', '-e', sys.argv[1]], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
output = b''
sent = False
deadline = time.monotonic() + 6
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], .05)[0]:
            output += os.read(master, 65536)
        if b'CLEANUP_READY' in output and not sent:
            os.write(master, b'\\x1b[99;5u\\x03\\x1b[99;5u\\x03')
            sent = True
        if child.poll() is not None:
            while select.select([master], [], [], .05)[0]:
                output += os.read(master, 65536)
            break
    assert child.poll() == 0, repr(output)
    assert sent and b'DONE' in output, repr(output)
    assert b'99;5u' not in output, repr(output)
    assert output.index(b'\\x1b[=0u') < output.index(b'CLEANUP_READY'), repr(output)
    restored = termios.tcgetattr(slave)
    mask = termios.ECHO | termios.ICANON | termios.ISIG
    assert restored[3] & mask == initial[3] & mask, (initial, restored)
    print('PTY: repeated interrupts consumed, keyboard reset before cleanup, cooked input restored')
finally:
    if child.poll() is None: child.kill()
    child.wait()
    os.close(master)
    os.close(slave)
`
      const { stdout } = await promisify(execFile)("python3", ["-c", python, fixture], { timeout: 8000 })
      expect(stdout).toContain("cooked input restored")
    },
    10000
  )
})

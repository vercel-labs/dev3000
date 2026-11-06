import { EventEmitter } from "node:events"
import { StringDecoder } from "node:string_decoder"

const START = "\x1b[200~"
const END = "\x1b[201~"

/** Preserve terminal editing; intercept only explicit clipboard/paste input. */
export class ImageInput extends EventEmitter {
  constructor(input, images, readClipboard, onError) {
    super()
    this.input = input
    this.isTTY = input.isTTY
    this.images = images
    this.readClipboard = readClipboard
    this.onError = onError
    this.decoder = new StringDecoder("utf8")
    this.buffer = ""
    this.commands = Promise.resolve()
    this.active = true
    this.mode = "composer"
    this.receive = (chunk) => {
      const text = this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      this.commands = this.commands.then(() => this.consume(text)).catch((error) => this.onError(error))
    }
    input.on("data", this.receive)
  }
  resume() {
    this.input.resume()
    return this
  }
  pause() {
    this.input.pause()
    return this
  }
  setRawMode(mode) {
    this.input.setRawMode?.(mode)
    return this
  }
  output(text) {
    if (this.active && text) this.emit("data", Buffer.from(text))
  }
  inject(text) {
    this.output(START + text + END)
  }
  async consume(text) {
    if (!this.active) return
    if (this.mode !== "composer") {
      this.output(text)
      return
    }
    clearTimeout(this.prefixTimer)
    this.buffer += text
    while (this.buffer) {
      if (this.buffer.startsWith(START)) {
        const end = this.buffer.indexOf(END, START.length)
        if (end < 0) {
          if (this.buffer.length > 1024 * 1024) {
            this.buffer = ""
            throw new Error("Paste is too large")
          }
          return
        }
        const paste = this.buffer.slice(START.length, end)
        this.buffer = this.buffer.slice(end + END.length)
        this.inject(await this.images.replacePaths(paste))
        continue
      }
      // Hold a split framing prefix briefly, while keeping a lone Escape usable.
      let suffix = 0
      for (let length = 1; length < START.length; length++) {
        if (this.buffer.endsWith(START.slice(0, length))) suffix = length
      }
      if (suffix === this.buffer.length) {
        this.prefixTimer = setTimeout(() => {
          this.commands = this.commands
            .then(() => {
              const remaining = this.buffer
              this.buffer = ""
              this.output(remaining)
            })
            .catch(this.onError)
        }, 50)
        return
      }
      const paste = this.buffer.indexOf(START)
      const clipboard = this.buffer.indexOf("\x16")
      const boundary = Math.min(...[paste, clipboard].filter((index) => index >= 0), this.buffer.length - suffix)
      if (boundary > 0) {
        const raw = this.buffer.slice(0, boundary)
        this.buffer = this.buffer.slice(boundary)
        // Cmd+V and file drags can arrive as an unframed escaped file path.
        const replaced = await this.images.replacePaths(raw)
        if (replaced !== raw) this.output(replaced)
        else this.output(raw)
        continue
      }
      if (clipboard === 0) {
        this.buffer = this.buffer.slice(1)
        try {
          this.inject(this.images.add(await this.readClipboard()))
        } catch (error) {
          this.onError(error)
        }
        continue
      }
      break
    }
  }
  close() {
    clearTimeout(this.prefixTimer)
    this.active = false
    this.input.off("data", this.receive)
  }
}

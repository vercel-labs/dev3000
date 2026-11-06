import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

/** Parse image paths as data. Never evaluate pasted text in a shell. */
export function imagePaths(text) {
  const paths = []
  for (let start = 0; start < text.length; start++) {
    if (start && !/\s/.test(text[start - 1])) continue
    let cursor = start
    const quote = ["'", '"'].includes(text[cursor]) ? text[cursor++] : undefined
    if (!text.slice(cursor).match(/^(?:\/|~\/|file:\/\/)/)) continue
    let path = ""
    let closed = !quote
    for (; cursor < text.length; cursor++) {
      const character = text[cursor]
      if (quote && character === quote) {
        cursor++
        closed = true
        break
      }
      if (!quote && /\s/.test(character)) break
      if (character === "\\" && quote !== "'" && cursor + 1 < text.length) path += text[++cursor]
      else path += character
    }
    if (!closed || !/\.(png|jpe?g|webp)$/i.test(path)) continue
    if (path.startsWith("~/")) path = homedir() + path.slice(1)
    if (path.startsWith("file://")) {
      try {
        path = fileURLToPath(path)
      } catch {
        continue
      }
    }
    paths.push({ start, end: cursor, path })
    start = cursor - 1
  }
  return paths
}

export class Images {
  constructor(readImage) {
    this.readImage = readImage
    this.pending = new Map()
    this.next = 1
  }
  add(image) {
    if (this.pending.size >= 4) throw new Error("Send or clear the attached images before adding more (maximum four)")
    const marker = `[Image #${this.next++}]`
    this.pending.set(marker, {
      ...image,
      filename: `${marker}.${image.mediaType === "image/jpeg" ? "jpg" : image.mediaType === "image/webp" ? "webp" : "png"}`
    })
    return marker
  }
  async replacePaths(text) {
    const replacements = []
    for (const candidate of imagePaths(text)) {
      let image
      try {
        image = await this.readImage(candidate.path)
      } catch (error) {
        // A remote path mentioned in a prompt is not a local attachment.
        if (error.code === "ENOENT" || error.code === "ENOTDIR") continue
        throw error
      }
      replacements.push({ ...candidate, image })
    }
    if (this.pending.size + replacements.length > 4) throw new Error("At most four images can be attached per message")
    let result = ""
    let after = 0
    for (const replacement of replacements) {
      result += text.slice(after, replacement.start) + this.add(replacement.image)
      after = replacement.end
    }
    return result + text.slice(after)
  }
  message(text) {
    const images = [...this.pending].filter(([marker]) => text.includes(marker)).map(([, image]) => image)
    return images.length ? [{ type: "text", text }, ...images] : text
  }
  clear() {
    this.pending.clear()
  }
}

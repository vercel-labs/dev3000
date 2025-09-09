// Generate PNG icons from canvas for Chrome extension
// Run this in browser console or as a Node.js script

function generateIcon(size, active = false) {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, "#1a1a2e")
  gradient.addColorStop(0.5, "#16213e")
  gradient.addColorStop(1, "#0f3460")

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  // Terminal window
  const termX = size * 0.125
  const termY = size * 0.2
  const termW = size * 0.75
  const termH = size * 0.6

  ctx.fillStyle = active ? "#1e1e2e" : "rgba(30, 30, 46, 0.8)"
  ctx.fillRect(termX, termY, termW, termH)

  // Terminal header
  ctx.fillStyle = active ? "#2a2a3e" : "rgba(42, 42, 62, 0.8)"
  ctx.fillRect(termX, termY, termW, size * 0.08)

  // Terminal dots
  const dotRadius = size * 0.015
  const dotY = termY + size * 0.04

  ctx.fillStyle = active ? "#ff5f56" : "rgba(255, 95, 86, 0.6)"
  ctx.beginPath()
  ctx.arc(termX + size * 0.05, dotY, dotRadius, 0, 2 * Math.PI)
  ctx.fill()

  ctx.fillStyle = active ? "#ffbd2e" : "rgba(255, 189, 46, 0.6)"
  ctx.beginPath()
  ctx.arc(termX + size * 0.1, dotY, dotRadius, 0, 2 * Math.PI)
  ctx.fill()

  ctx.fillStyle = active ? "#27c93f" : "rgba(39, 201, 63, 0.6)"
  ctx.beginPath()
  ctx.arc(termX + size * 0.15, dotY, dotRadius, 0, 2 * Math.PI)
  ctx.fill()

  // d3k text
  ctx.fillStyle = active ? "#58a6ff" : "rgba(88, 166, 255, 0.7)"
  ctx.font = `bold ${size * 0.15}px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.textAlign = "center"
  ctx.fillText("d3k", size / 2, size * 0.55)

  // Log lines (if active)
  if (active || size >= 48) {
    const opacity = active ? 0.8 : 0.4
    const lineHeight = size * 0.02
    const lineStart = termX + size * 0.05

    ctx.fillStyle = `rgba(86, 211, 100, ${opacity})`
    ctx.fillRect(lineStart, size * 0.65, termW * 0.7, lineHeight)

    ctx.fillStyle = `rgba(88, 166, 255, ${opacity})`
    ctx.fillRect(lineStart, size * 0.7, termW * 0.5, lineHeight)

    ctx.fillStyle = `rgba(192, 132, 252, ${opacity})`
    ctx.fillRect(lineStart, size * 0.75, termW * 0.6, lineHeight)
  }

  // Status indicator (for active state)
  if (active && size >= 16) {
    const statusRadius = size * 0.08
    const statusX = size * 0.85
    const statusY = size * 0.2

    ctx.fillStyle = "#22c55e"
    ctx.beginPath()
    ctx.arc(statusX, statusY, statusRadius, 0, 2 * Math.PI)
    ctx.fill()

    ctx.fillStyle = "#27c93f"
    ctx.beginPath()
    ctx.arc(statusX, statusY, statusRadius * 0.7, 0, 2 * Math.PI)
    ctx.fill()
  }

  return canvas
}

// Generate and download icons
function downloadIcon(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, "image/png")
}

// Generate all sizes
const sizes = [16, 48, 128]
sizes.forEach((size) => {
  const canvas = generateIcon(size, false)
  downloadIcon(canvas, `icon${size}.png`)
})

console.log("PNG icons generated! Check your downloads folder.")

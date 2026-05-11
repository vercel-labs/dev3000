export function validatePortOption(port: string): string {
  if (!/^\d+$/.test(port)) {
    throw new Error("--port must be a numeric port number.")
  }
  const parsed = Number.parseInt(port, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("--port must be between 1 and 65535.")
  }
  return String(parsed)
}

export function validatePositiveIntegerOption(name: string, value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`)
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return String(parsed)
}

export function validateScriptOption(script: string): string {
  if (script.startsWith("-")) {
    throw new Error("--script must name a script or file and cannot start with a hyphen.")
  }
  if (!/^[A-Za-z0-9._:/-]+$/.test(script)) {
    throw new Error("--script may only contain letters, numbers, dots, slashes, colons, underscores, and hyphens.")
  }
  return script
}

export function validateDateTimeOption(value: string): "local" | "utc" {
  if (value !== "local" && value !== "utc") {
    throw new Error("--date-time must be either 'local' or 'utc'.")
  }
  return value
}

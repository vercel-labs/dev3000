import { spawn } from "node:child_process"

interface SkillSearchResult {
  id: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl?: string
  installsLabel?: string
}

function stripAnsi(value: string): string {
  let result = ""

  for (let index = 0; index < value.length; index++) {
    const charCode = value.charCodeAt(index)
    if (charCode === 27 && value[index + 1] === "[") {
      while (index < value.length && value[index] !== "m") {
        index++
      }
      continue
    }
    result += value[index]
  }

  return result
}

function titleCaseSkillName(skillName: string): string {
  return skillName
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function parseSkillsFindOutput(stdout: string): SkillSearchResult[] {
  const lines = stripAnsi(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const results: SkillSearchResult[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.includes("@") || line.startsWith("Usage:") || line.startsWith("Install with")) {
      continue
    }

    const match = line.match(/^([^\s]+)\s+(.+ installs)$/)
    if (!match) {
      continue
    }

    const installArg = match[1]
    const packageAndSkill = installArg.split("@")
    if (packageAndSkill.length < 2) {
      continue
    }

    const skillName = packageAndSkill[packageAndSkill.length - 1]
    const packageName = packageAndSkill.slice(0, -1).join("@")
    const nextLine = lines[index + 1]
    const sourceUrl = nextLine?.startsWith("└ ") ? nextLine.replace(/^└\s+/, "") : undefined

    results.push({
      id: skillName.toLowerCase(),
      installArg,
      packageName,
      skillName,
      displayName: titleCaseSkillName(skillName),
      sourceUrl,
      installsLabel: match[2]
    })
  }

  return results
}

async function runSkillsFind(query: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "skills@latest", "find", query], {
      env: process.env
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || `skills find exited with code ${code}`))
        return
      }
      resolve(stdout || stderr)
    })
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim() || ""

  if (query.length < 2) {
    return Response.json({ success: true, results: [] })
  }

  try {
    const output = await runSkillsFind(query)
    const results = parseSkillsFindOutput(output)
    return Response.json({ success: true, results })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        results: []
      },
      { status: 500 }
    )
  }
}

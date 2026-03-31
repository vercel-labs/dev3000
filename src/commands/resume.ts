import chalk from "chalk"
import { spawn } from "child_process"
import { basename } from "path"
import { checkBinaryExists } from "../utils/agent-selection.js"
import { readProjectAgentName as readRememberedProjectAgentName } from "../utils/project-metadata.js"
import { loadUserConfig } from "../utils/user-config.js"

interface ResumeLaunchSpec {
  agentName: string
  binary: string
  args: string[]
}

function ensureCommandPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.PATH || env.PATH === "") {
    env.PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  }

  return env
}

export function readProjectAgentName(cwd: string = process.cwd()): string | null {
  return readRememberedProjectAgentName(cwd)
}

export function resolveResumeAgentName(cwd: string = process.cwd()): string | null {
  const projectAgentName = readProjectAgentName(cwd)
  if (projectAgentName) {
    return projectAgentName
  }

  const defaultAgentName = loadUserConfig().defaultAgent?.name
  return typeof defaultAgentName === "string" && defaultAgentName.trim().length > 0 ? defaultAgentName.trim() : null
}

export function getResumeLaunchSpec(agentName: string, cwd: string = process.cwd()): ResumeLaunchSpec | null {
  switch (agentName.toLowerCase()) {
    case "claude":
      return { agentName, binary: "claude", args: ["-c"] }
    case "claude-yolo":
      return { agentName, binary: "claude", args: ["--dangerously-skip-permissions", "-c"] }
    case "codex":
      return { agentName, binary: "codex", args: ["resume", "--last", "-C", cwd] }
    case "codex-yolo":
      return {
        agentName,
        binary: "codex",
        args: ["resume", "--last", "--dangerously-bypass-approvals-and-sandbox", "-C", cwd]
      }
    case "opencode":
      return { agentName, binary: "opencode", args: ["-c"] }
    default:
      return null
  }
}

export async function resumeLastAgent(cwd: string = process.cwd()): Promise<void> {
  const agentName = resolveResumeAgentName(cwd)
  if (!agentName) {
    console.error(chalk.red("❌ No previous agent found for this project."))
    console.error(chalk.gray("Start d3k with an agent once, then `d3k resume` can reopen it here."))
    process.exit(1)
  }

  const spec = getResumeLaunchSpec(agentName, cwd)
  if (!spec) {
    console.error(chalk.red(`❌ Agent "${agentName}" does not support automatic resume yet.`))
    console.error(chalk.gray("Supported today: claude, claude-yolo, codex, codex-yolo, opencode"))
    process.exit(1)
  }

  if (!checkBinaryExists(spec.binary)) {
    console.error(chalk.red(`❌ ${spec.binary} is not installed or not on PATH.`))
    process.exit(1)
  }

  console.log(chalk.cyan(`↩ Resuming ${spec.agentName} for ${basename(cwd)}...`))

  const env = ensureCommandPath({ ...process.env })
  const child = spawn(spec.binary, spec.args, {
    cwd,
    env,
    stdio: "inherit",
    shell: false
  })

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })

  process.exit(exitCode)
}

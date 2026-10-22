import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { getBundledD3kSkillPath } from "../skills/index.js"
import { getSkillsPathForLocation, type SkillsAgentId } from "./skill-installer.js"

/** Reuse an agent's global d3k skill before installing a project-local fallback. */
export function ensureD3kSkill(agentId: SkillsAgentId = "codex"): void {
  try {
    const globalSkillsRoot = getSkillsPathForLocation(agentId, "global")?.path || join(homedir(), ".agents", "skills")
    if (existsSync(join(globalSkillsRoot, "d3k", "SKILL.md"))) {
      return
    }

    const bundledSkillPath = getBundledD3kSkillPath()
    if (!bundledSkillPath) return

    const projectSkillsRoot =
      getSkillsPathForLocation(agentId, "project")?.path || join(process.cwd(), ".agents", "skills")
    const skillDir = join(projectSkillsRoot, "d3k")
    const skillPath = join(skillDir, "SKILL.md")
    const bundledContent = readFileSync(bundledSkillPath, "utf-8")

    if (existsSync(skillPath) && readFileSync(skillPath, "utf-8") === bundledContent) {
      return
    }

    mkdirSync(skillDir, { recursive: true })
    copyFileSync(bundledSkillPath, skillPath)
  } catch {
    // Skill installation is optional and must not prevent the runtime from starting.
  }
}

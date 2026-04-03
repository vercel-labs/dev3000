import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import type {
  DevAgentActionStep,
  DevAgentAiAgent,
  DevAgentEarlyExitMode,
  DevAgentEarlyExitRule,
  DevAgentExecutionMode,
  DevAgentSandboxBrowser,
  DevAgentSkillRef
} from "@/lib/dev-agents"

const ASH_RUNTIME_VERSION = "experimental-ash@0.1.0-alpha.29"

export interface DevAgentAshArtifact {
  framework: "experimental-ash"
  revision: number
  specHash: string
  generatedAt: string
  packageName: string
  packageVersion: string
  sourceLabel: string
  systemPrompt: string
  packagedSkills?: string[]
  tarballUrl?: string
}

export interface DevAgentAshSource {
  packageName: string
  packageVersion: string
  systemPrompt: string
  sourceLabel: string
  specHash: string
  packagedSkills: string[]
  files: Array<{ path: string; content: string }>
}

export interface DevAgentAshInput {
  id: string
  name: string
  description: string
  instructions: string
  executionMode: DevAgentExecutionMode
  sandboxBrowser: DevAgentSandboxBrowser
  aiAgent?: DevAgentAiAgent
  devServerCommand?: string
  actionSteps?: DevAgentActionStep[]
  skillRefs: DevAgentSkillRef[]
  createdAt: string
  successEval?: string
  earlyExitMode?: DevAgentEarlyExitMode
  earlyExitEval?: string
  earlyExitRule?: DevAgentEarlyExitRule
  earlyExitPlacementIndex?: number
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

function escapeTypeScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function normalizeMultiline(value?: string): string {
  return (value || "").replaceAll("\r\n", "\n").trim()
}

function formatExecutionMode(mode: DevAgentExecutionMode): string {
  return mode === "preview-pr" ? "preview-pr" : "dev-server"
}

function formatSandboxBrowser(browser: DevAgentSandboxBrowser): string {
  return browser
}

function formatAiAgent(aiAgent?: DevAgentAiAgent): string {
  if (aiAgent === "anthropic/claude-sonnet-4.6") return "anthropic/claude-sonnet-4.6"
  return "anthropic/claude-opus-4.6"
}

function formatActionStep(step: DevAgentActionStep, index: number): string {
  const configEntries = Object.entries(step.config || {}).filter(([, value]) => value?.trim())
  const configSuffix =
    configEntries.length > 0 ? ` (${configEntries.map(([key, value]) => `${key}: ${value.trim()}`).join(", ")})` : ""

  switch (step.kind) {
    case "browse-to-page":
      return `${index + 1}. Browse to the target page${configSuffix}.`
    case "start-dev-server":
      return `${index + 1}. Start the local development server${configSuffix}.`
    case "capture-loading-frames":
      return `${index + 1}. Capture a loading sequence with screenshots${configSuffix}.`
    case "capture-cwv":
      return `${index + 1}. Capture Core Web Vitals${configSuffix}.`
    case "go-back-to-step":
      return `${index + 1}. Loop back to an earlier step${configSuffix}.`
    case "send-prompt":
      return `${index + 1}. ${normalizeMultiline(step.config.prompt || "Execute the configured prompt.")}`
    default:
      return `${index + 1}. ${step.kind}${configSuffix}`
  }
}

function formatSkillLine(skill: DevAgentSkillRef): string {
  const details = [
    skill.displayName,
    skill.skillName !== skill.displayName ? `skillName=${skill.skillName}` : null,
    skill.installArg ? `install=${skill.installArg}` : null
  ]
    .filter(Boolean)
    .join(" | ")
  return `- ${details}`
}

function formatEarlyExitRule(rule?: DevAgentEarlyExitRule): string {
  if (!rule) return "No structured early-exit rule is configured."

  const metricLabel = rule.label?.trim() || rule.metricKey
  if (rule.valueType === "number") {
    if (rule.operator === "between") {
      return `${metricLabel} must be between ${rule.valueNumber ?? "?"} and ${rule.secondaryValueNumber ?? "?"}.`
    }
    return `${metricLabel} ${rule.operator} ${rule.valueNumber ?? "?"}.`
  }

  if (rule.valueType === "boolean") {
    return `${metricLabel} ${rule.operator} ${String(rule.valueBoolean ?? false)}.`
  }

  return `${metricLabel} ${rule.operator} "${rule.valueString ?? ""}".`
}

function createCanonicalSpec(input: DevAgentAshInput) {
  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    id: input.id,
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: normalizeMultiline(input.instructions),
    executionMode: input.executionMode,
    sandboxBrowser: input.sandboxBrowser,
    aiAgent: input.aiAgent || "anthropic/claude-opus-4.6",
    devServerCommand: normalizeMultiline(input.devServerCommand),
    actionSteps: (input.actionSteps || []).map((step) => ({
      kind: step.kind,
      config: Object.fromEntries(Object.entries(step.config || {}).map(([key, value]) => [key, value.trim()]))
    })),
    skillRefs: input.skillRefs.map((skill) => ({
      id: skill.id,
      installArg: skill.installArg,
      packageName: skill.packageName || "",
      skillName: skill.skillName,
      displayName: skill.displayName,
      sourceUrl: skill.sourceUrl || ""
    })),
    successEval: normalizeMultiline(input.successEval),
    earlyExitMode: input.earlyExitMode || null,
    earlyExitEval: normalizeMultiline(input.earlyExitEval),
    earlyExitRule: input.earlyExitRule
      ? {
          metricType: input.earlyExitRule.metricType,
          metricKey: input.earlyExitRule.metricKey,
          label: input.earlyExitRule.label || "",
          valueType: input.earlyExitRule.valueType,
          operator: input.earlyExitRule.operator,
          valueNumber: input.earlyExitRule.valueNumber ?? null,
          secondaryValueNumber: input.earlyExitRule.secondaryValueNumber ?? null,
          valueBoolean: input.earlyExitRule.valueBoolean ?? null,
          valueString: input.earlyExitRule.valueString ?? ""
        }
      : null,
    earlyExitPlacementIndex: typeof input.earlyExitPlacementIndex === "number" ? input.earlyExitPlacementIndex : null
  }
}

function renderSystemPrompt(input: DevAgentAshInput): string {
  const actionSteps = input.actionSteps?.length
    ? input.actionSteps.map((step, index) => formatActionStep(step, index)).join("\n")
    : "No explicit action-step choreography is configured. Use the authored instructions as the primary task."

  const skillLines =
    input.skillRefs.length > 0
      ? input.skillRefs.map((skill) => formatSkillLine(skill)).join("\n")
      : "- No additional skills are configured."

  const successEval = normalizeMultiline(input.successEval) || "No explicit success eval is configured."
  const earlyExitEval = normalizeMultiline(input.earlyExitEval) || "No text-mode early-exit eval is configured."

  return `# Identity

You are the "${input.name.trim()}" dev agent inside the dev3000 platform.

## Description

${input.description.trim()}

## Primary Instructions

${normalizeMultiline(input.instructions) || "No freeform instructions were provided. Follow the configured action steps and evaluation criteria."}

## Runtime Contract

- Execution mode: ${formatExecutionMode(input.executionMode)}
- Sandbox browser: ${formatSandboxBrowser(input.sandboxBrowser)}
- Model preference: ${formatAiAgent(input.aiAgent)}
${normalizeMultiline(input.devServerCommand) ? `- Dev server command: \`${normalizeMultiline(input.devServerCommand)}\`` : "- Dev server command: none"}

## Action Plan

${actionSteps}

## Skills

${skillLines}

## Success Evaluation

${successEval}

## Early Exit

- Mode: ${input.earlyExitMode || "none"}
- Structured rule: ${formatEarlyExitRule(input.earlyExitRule)}
- Text eval: ${earlyExitEval}
`
}

function renderRuntimeContractLayer(input: DevAgentAshInput): string {
  const lines = [
    `This agent was generated from a dev3000 dev-agent spec.`,
    `Execution mode: ${formatExecutionMode(input.executionMode)}`,
    `Sandbox browser: ${formatSandboxBrowser(input.sandboxBrowser)}`,
    `Preferred model: ${formatAiAgent(input.aiAgent)}`
  ]

  if (normalizeMultiline(input.devServerCommand)) {
    lines.push(`Dev server command: \`${normalizeMultiline(input.devServerCommand)}\``)
  }

  return lines.join("\n")
}

function renderSkillsLayer(input: DevAgentAshInput): string {
  if (input.skillRefs.length === 0) {
    return "No external skills are configured for this agent."
  }

  return [
    "The following platform skills are part of this agent configuration.",
    "",
    ...input.skillRefs.map((skill) => formatSkillLine(skill))
  ].join("\n")
}

function renderEvaluationLayer(input: DevAgentAshInput): string {
  return [
    `Success eval: ${normalizeMultiline(input.successEval) || "none configured"}`,
    `Early exit mode: ${input.earlyExitMode || "none"}`,
    `Early exit rule: ${formatEarlyExitRule(input.earlyExitRule)}`,
    `Early exit text eval: ${normalizeMultiline(input.earlyExitEval) || "none configured"}`
  ].join("\n")
}

function renderReadme(input: DevAgentAshInput, revision: number, specHash: string): string {
  return `# ${input.name.trim()}

Generated by dev3000 as an ASH-compatible agent package.

- Dev Agent ID: \`${input.id}\`
- Revision: \`v${revision}\`
- Spec hash: \`${specHash}\`
- Generated from: dev3000 create/edit form
- Runtime target: ${ASH_RUNTIME_VERSION}

This package is a deterministic build artifact of the stored dev-agent spec. The source of truth remains the dev-agent configuration in dev3000.
`
}

async function collectTextFiles(baseDir: string, relativeDir = ""): Promise<Array<{ path: string; content: string }>> {
  const dir = path.join(baseDir, relativeDir)
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<{ path: string; content: string }> = []

  for (const entry of entries) {
    const nextRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(baseDir, nextRelative)))
      continue
    }
    const absolutePath = path.join(baseDir, nextRelative)
    files.push({
      path: nextRelative.replaceAll("\\", "/"),
      content: await readFile(absolutePath, "utf8")
    })
  }

  return files
}

async function resolvePackagedSkillFiles(
  input: DevAgentAshInput
): Promise<{ packagedSkills: string[]; files: Array<{ path: string; content: string }> }> {
  const packagedSkills: string[] = []
  const files: Array<{ path: string; content: string }> = []
  const cwd = process.cwd()
  const pluginCacheRoot = path.join(
    process.env.HOME || "",
    ".codex/plugins/cache/openai-curated/vercel/f78e3ad49297672a905eb7afb6aa0cef34edc79e/skills"
  )

  for (const skill of input.skillRefs) {
    const candidateDirs = [
      path.join(cwd, ".agents/skills", skill.skillName),
      path.join(cwd, "..", ".agents/skills", skill.skillName),
      path.join(pluginCacheRoot, skill.skillName)
    ]

    let resolvedDir: string | null = null
    for (const candidate of candidateDirs) {
      try {
        const entries = await readdir(candidate)
        if (entries.length > 0) {
          resolvedDir = candidate
          break
        }
      } catch {
        // Try next candidate.
      }
    }

    if (!resolvedDir) continue

    const skillFiles = await collectTextFiles(resolvedDir)
    if (skillFiles.length === 0) continue

    packagedSkills.push(skill.displayName || skill.skillName)
    files.push(
      ...skillFiles.map((file) => ({
        path: `agent/skills/${skill.skillName}/${file.path}`,
        content: file.content
      }))
    )
  }

  return { packagedSkills, files }
}

export async function createDevAgentAshSource(input: DevAgentAshInput, revision: number): Promise<DevAgentAshSource> {
  const canonicalSpec = createCanonicalSpec(input)
  const specHash = createHash("sha256").update(JSON.stringify(canonicalSpec)).digest("hex")
  const slug = slugify(input.name) || input.id
  const packageName = `dev-agent-${slug}`
  const packageVersion = `0.0.${revision}`
  const systemPrompt = renderSystemPrompt(input)
  const sourceLabel = `${input.name.trim()} v${revision}`
  const packagedSkillData = await resolvePackagedSkillFiles(input)
  const files = [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: packageName,
          version: packageVersion,
          private: true,
          type: "module",
          scripts: {
            build: "ash build",
            dev: "ash dev",
            typecheck: "tsgo"
          },
          dependencies: {
            "experimental-ash": "^0.1.0-alpha.29",
            zod: "^4.3.6"
          },
          devDependencies: {
            "@typescript/native-preview": "7.0.0-dev.20260320.1"
          }
        },
        null,
        2
      )
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            skipLibCheck: true
          },
          include: ["agent/**/*.ts"]
        },
        null,
        2
      )
    },
    {
      path: "README.md",
      content: renderReadme(input, revision, specHash)
    },
    {
      path: "agent/agent.ts",
      content: `import { defineAgent } from "experimental-ash";

export default defineAgent({
  id: "${escapeTypeScriptString(input.id)}",
  model: "${escapeTypeScriptString(formatAiAgent(input.aiAgent))}",
});
`
    },
    {
      path: "agent/system.md",
      content: systemPrompt
    },
    {
      path: "agent/system/runtime-contract.md",
      content: renderRuntimeContractLayer(input)
    },
    {
      path: "agent/system/evaluation.md",
      content: renderEvaluationLayer(input)
    },
    {
      path: "agent/system/skills.md",
      content: renderSkillsLayer(input)
    },
    {
      path: "agent/spec.json",
      content: JSON.stringify(canonicalSpec, null, 2)
    },
    {
      path: "agent/skills-manifest.json",
      content: JSON.stringify(
        {
          packagedSkills: packagedSkillData.packagedSkills
        },
        null,
        2
      )
    },
    ...packagedSkillData.files
  ]

  return {
    packageName,
    packageVersion,
    systemPrompt,
    sourceLabel,
    specHash,
    packagedSkills: packagedSkillData.packagedSkills,
    files
  }
}

export function createDevAgentAshArtifactDescriptor(
  input: DevAgentAshInput,
  revision = 1,
  generatedAt = new Date().toISOString()
): DevAgentAshArtifact {
  const canonicalSpec = createCanonicalSpec(input)
  const specHash = createHash("sha256").update(JSON.stringify(canonicalSpec)).digest("hex")
  const slug = slugify(input.name) || input.id
  const packageName = `dev-agent-${slug}`
  const packageVersion = `0.0.${revision}`
  const sourceLabel = `${input.name.trim()} v${revision}`
  const systemPrompt = renderSystemPrompt(input)
  return {
    framework: "experimental-ash",
    revision,
    specHash,
    generatedAt,
    packageName,
    packageVersion,
    sourceLabel,
    systemPrompt
  }
}

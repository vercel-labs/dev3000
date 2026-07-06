import { SKILL_RUNNER_WORKER_ROOT_DIRECTORY } from "./skill-runner-config"

// Single source of truth for the file set that makes up the self-hosted
// skill-runner shell. Consumed by both the runtime deployer
// (www/lib/skill-runner-shell-source.ts) and the offline artifact builder
// (scripts/build-skill-runner-shell-artifact.ts). Keeping one list prevents
// the two from drifting and silently shipping an incomplete shell.
export const RUNNER_SHELL_ROOT_FILES = new Set(["package.json", "bun.lock"])

export const RUNNER_SHELL_EXACT_FILES = new Set([
  "www/app/api/cloud/fix-workflow/health/route.ts",
  "www/app/api/cloud/fix-workflow/steps.ts",
  "www/app/api/cloud/fix-workflow/workflow.ts",
  "www/app/api/blob/route.ts",
  "www/app/api/cloud/start-fix/route.ts",
  "www/app/api/skill-runner-worker/version/route.ts",
  "www/app/skill-runner-worker-home.tsx",
  "www/app/skill-runner-worker-layout.tsx",
  "www/bunfig.toml",
  "www/lib/ai-gateway.ts",
  "www/lib/auth.ts",
  "www/lib/blob-store.ts",
  "www/lib/constants.ts",
  "www/lib/deepsec-partial-report.ts",
  "www/lib/dev-agent-eve-spec.ts",
  "www/lib/dev-agent-eve.ts",
  "www/lib/dev-agents.ts",
  "www/lib/dev-server-command.ts",
  "www/lib/file-to-route.ts",
  "www/lib/oidc-token-binding.ts",
  "www/lib/report-redaction.ts",
  "www/lib/skill-runner-config.ts",
  "www/lib/skill-runner-runtime.ts",
  "www/lib/skill-runner-shell-files.ts",
  "www/lib/skill-runner-shell-source.ts",
  "www/lib/skill-runner-worker.ts",
  "www/lib/skill-runners.ts",
  "www/lib/skills-sh.ts",
  "www/lib/team-selection.ts",
  "www/lib/telemetry-storage.ts",
  "www/lib/telemetry.ts",
  "www/lib/vercel-cli-sandbox-context.ts",
  "www/lib/vercel-protection-bypass.ts",
  "www/lib/vercel-teams.ts",
  "www/lib/workflow-api.ts",
  "www/lib/workflow-logger.ts",
  "www/lib/workflow-report-blob.ts",
  "www/lib/workflow-report-summary.ts",
  "www/lib/workflow-storage.ts",
  "www/next.config.ts",
  "www/package.json",
  "www/scripts/patch-workflow-vercel-config.mjs",
  "www/tsconfig.json",
  "www/types.ts",
  "www/vercel.json"
])

export const RUNNER_SHELL_INCLUDED_PREFIXES = ["www/app/.well-known/workflow/v1/", "www/lib/cloud/", "www/lib/skills/"]

export const RUNNER_SHELL_PATH_OVERRIDES = new Map([
  [
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/skill-runner-worker-home.tsx`,
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/page.tsx`
  ],
  [
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/skill-runner-worker-layout.tsx`,
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/layout.tsx`
  ]
])

export function isRunnerShellFile(file: string): boolean {
  if (RUNNER_SHELL_ROOT_FILES.has(file)) return true
  if (RUNNER_SHELL_EXACT_FILES.has(file)) return true
  return RUNNER_SHELL_INCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))
}

export function resolveRunnerShellDeploymentPath(file: string): string {
  return RUNNER_SHELL_PATH_OVERRIDES.get(file) || file
}

export function encodeRunnerShellPathForUrl(file: string): string {
  return file
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

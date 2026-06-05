import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import type {
  DevAgentActionStep,
  DevAgentAiAgent,
  DevAgentAshCompiledSpec,
  DevAgentEarlyExitMode,
  DevAgentEarlyExitRule,
  DevAgentExecutionMode,
  DevAgentSandboxBrowser,
  DevAgentSkillRef
} from "@/lib/dev-agents"

const ASH_PACKAGE_NAME = "experimental-ash"
const ASH_PACKAGE_VERSION = "0.61.0"
const ASH_AI_PACKAGE_VERSION = "7.0.0-canary.159"
const ASH_RUNTIME_VERSION = `${ASH_PACKAGE_NAME}@${ASH_PACKAGE_VERSION}`
const ASH_ARTIFACT_FORMAT_VERSION = 16

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
  compiledSpec?: DevAgentAshCompiledSpec
  tarballUrl?: string
}

export interface DevAgentAshSource {
  packageName: string
  packageVersion: string
  systemPrompt: string
  sourceLabel: string
  specHash: string
  packagedSkills: string[]
  compiledSpec: DevAgentAshCompiledSpec
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

function isDeepSecAshInput(input: DevAgentAshInput): boolean {
  return input.id.trim().toLowerCase() === "deepsec" || input.name.trim().toLowerCase() === "deepsec security scan"
}

function renderDeepSecRuntimeNotes(input: DevAgentAshInput): string {
  if (!isDeepSecAshInput(input)) return ""

  return `## DeepSec Runtime Notes

- Use shell commands for project file inspection and file writes. Prefer \`test -f\`, \`cat\`, \`sed\`, \`find\`, and \`grep\` inside \`/workspace/repo\`.
- Optional project files may be absent. Check before reading optional files such as \`CLAUDE.md\`, \`AGENTS.md\`, and framework config files.
`
}

function renderDisabledFrameworkTool(): string {
  return `import { disableTool } from "experimental-ash/tools";

export default disableTool();
`
}

function getDisabledAutomationToolFiles() {
  return [
    {
      path: "agent/tools/todo.ts",
      content: renderDisabledFrameworkTool()
    }
  ]
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

function createCanonicalSpec(input: DevAgentAshInput): DevAgentAshCompiledSpec {
  return {
    schemaVersion: 1,
    artifactFormatVersion: ASH_ARTIFACT_FORMAT_VERSION,
    ashRuntimeVersion: ASH_RUNTIME_VERSION,
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

function renderExecutionRunbookSkill(input: DevAgentAshInput): string {
  const normalizedInstructions = normalizeMultiline(input.instructions)
  const actionPlan = input.actionSteps?.length
    ? input.actionSteps.map((step, index) => formatActionStep(step, index)).join("\n")
    : "No explicit action-step choreography is configured. Fall back to the primary instructions."

  const successEval = normalizeMultiline(input.successEval) || "No explicit success eval is configured."
  const earlyExitEval = normalizeMultiline(input.earlyExitEval) || "No text-mode early-exit eval is configured."

  return `---
name: dev3000-agent-runbook
description: Generated execution runbook for the ${input.name.trim()} dev3000 agent. Load this before starting the main task.
---

# Objective

${input.description.trim()}

## Primary Instructions

${normalizedInstructions || "No freeform instructions were provided. Follow the configured action plan and evaluation criteria."}

${renderDeepSecRuntimeNotes(input)}

## Action Plan

${actionPlan}

## Success Evaluation

${successEval}

## Early Exit

- Mode: ${input.earlyExitMode || "none"}
- Structured rule: ${formatEarlyExitRule(input.earlyExitRule)}
- Text eval: ${earlyExitEval}
`
}

function renderAshRuntimeMessageChannel(): string {
  return `import { httpBasic } from "experimental-ash/channels/auth";
import { ashChannel } from "experimental-ash/channels/ash";

const username = process.env.DEV3000_ASH_RUNTIME_USERNAME || "dev3000";
const runtimePassword = process.env.DEV3000_ASH_RUNTIME_PASSWORD;

if (!runtimePassword) {
  throw new Error("DEV3000_ASH_RUNTIME_PASSWORD is required for the generated Ash runtime route.");
}

const password = runtimePassword;

export default ashChannel({
  auth: httpBasic({
    username,
    password,
  }),
});
`
}

function renderAshRuntimeTaskChannel(): string {
  return `import { defineChannel, GET, POST } from "experimental-ash/channels";
import { createUnauthorizedResponse, verifyHttpBasic } from "experimental-ash/channels/auth";

const username = process.env.DEV3000_ASH_RUNTIME_USERNAME || "dev3000";
const runtimePassword = process.env.DEV3000_ASH_RUNTIME_PASSWORD;
const healthRoute = "/.well-known/ash/v1/health";
const taskRoute = "/.well-known/ash/v1/task";
const streamRoute = "/.well-known/ash/v1/sessions/:sessionId/stream";

if (!runtimePassword) {
  throw new Error("DEV3000_ASH_RUNTIME_PASSWORD is required for the generated Ash runtime route.");
}

const password = runtimePassword;

function authenticate(request: Request) {
    const auth = verifyHttpBasic(request.headers.get("authorization"), {
      username,
      password,
    });

    if (!auth.ok) {
      return createUnauthorizedResponse({
        challenges: [{ scheme: "Basic", parameters: { realm: "ash-task" } }],
      });
    }

  return auth.sessionAuth;
}

function parseStartIndex(request: Request): number | Response | undefined {
  const value = new URL(request.url).searchParams.get("startIndex");
  if (value === null) return undefined;

  const startIndex = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "Expected startIndex to be a non-negative integer.", ok: false }, { status: 400 });
  }

  return startIndex;
}

function serializeAsNdjson(stream: ReadableStream<unknown>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return stream.pipeThrough(
    new TransformStream<unknown, Uint8Array>({
      transform(event, controller) {
        controller.enqueue(encoder.encode(\`\${JSON.stringify(event)}\\n\`));
      },
    }),
  );
}

export default defineChannel({
  routes: [
    GET(healthRoute, async (request) => {
      const auth = authenticate(request);
      if (auth instanceof Response) return auth;

      return Response.json(
        { ok: true, status: "ready" },
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }),
    POST(taskRoute, async (request, { send }) => {
      const auth = authenticate(request);
      if (auth instanceof Response) return auth;

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body.", ok: false }, { status: 400 });
    }

    if (payload === null || typeof payload !== "object") {
      return Response.json({ error: "Expected a JSON object.", ok: false }, { status: 400 });
    }

    const message =
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message.trim()
        : "";

    if (!message) {
      return Response.json({ error: "Missing or empty 'message' field.", ok: false }, { status: 400 });
    }

    const continuationToken = \`http-task:\${crypto.randomUUID()}\`;
      const session = await send(message, {
      auth,
        continuationToken,
      mode: "task",
    });

      const streamPath = \`/.well-known/ash/v1/sessions/\${encodeURIComponent(session.id)}/stream\`;

      return Response.json(
        {
          continuationToken: session.continuationToken,
          ok: true,
          sessionId: session.id,
          streamPath,
          terminalState: "running",
        },
        {
          headers: {
            "cache-control": "no-store",
          },
          status: 202,
        },
      );
    }),
    GET(streamRoute, async (request, { getSession, params }) => {
      const auth = authenticate(request);
      if (auth instanceof Response) return auth;

      const sessionId = params.sessionId;
      if (!sessionId) {
        return Response.json({ error: "Missing session id.", ok: false }, { status: 400 });
      }

      const startIndex = parseStartIndex(request);
      if (startIndex instanceof Response) return startIndex;

      try {
        const stream = await getSession(sessionId).getEventStream({ startIndex });
        return new Response(serializeAsNdjson(stream), {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/x-ndjson; charset=utf-8",
            "x-ash-session-id": sessionId,
            "x-ash-stream-format": "ndjson",
            "x-ash-stream-version": "15",
          },
        });
      } catch {
        return Response.json({ error: "Session not found.", ok: false }, { status: 404 });
      }
    }),
  ],
});
`
}

function renderGeneratedSandboxDefinition(): string {
  return `import { execFile, spawn as spawnProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import {
  defineSandbox,
  type SandboxBackend,
  type SandboxCommandResult,
  type SandboxProcess,
  type SandboxReadTextFileOptions,
  type SandboxRunOptions,
  type SandboxSession,
  type SandboxSpawnOptions,
  type SandboxWriteFileOptions,
} from "experimental-ash/sandbox";

const projectRoot = process.env.DEV3000_PROJECT_ROOT?.trim();
const workspaceRoot = "/workspace";
const execFileAsync = promisify(execFile);
const templateStoreDir = path.join(process.cwd(), ".dev3000-host-sandbox-templates");

const ensureBunAvailableScript = [
  'set -e',
  'if [ -z "$HOME" ]; then export HOME="/home/vercel-sandbox"; fi',
  'export BUN_INSTALL="$HOME/.bun"',
  'export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:/usr/local/bin:/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/vercel/runtimes/nodejs/bin:/usr/bin:/bin:$PATH"',
  'BUN_BIN=""',
  'for candidate in "$BUN_INSTALL/bin/bun" "/usr/local/bin/bun"; do if [ -x "$candidate" ]; then BUN_BIN="$candidate"; break; fi; done',
  'if [ -z "$BUN_BIN" ]; then FOUND_BUN="$(PATH="/usr/local/bin:/usr/bin:/bin:$PATH" command -v bun || true)"; if [ -n "$FOUND_BUN" ] && [ "$FOUND_BUN" != "$HOME/.local/bin/bun" ]; then BUN_BIN="$FOUND_BUN"; fi; fi',
  'if [ -z "$BUN_BIN" ]; then curl -fsSL https://bun.sh/install | bash; BUN_BIN="$BUN_INSTALL/bin/bun"; fi',
  'if [ ! -x "$BUN_BIN" ]; then echo "Bun unavailable after ASH sandbox bootstrap" >&2; exit 1; fi',
  'BUN_BIN="$(readlink -f "$BUN_BIN" 2>/dev/null || printf "%s" "$BUN_BIN")"',
  'mkdir -p "$HOME/.local/bin"',
  'rm -f "$HOME/.local/bin/bun" "$HOME/.local/bin/bunx"',
  'ln -sf "$BUN_BIN" "$HOME/.local/bin/bun"',
  'if [ -x "$(dirname "$BUN_BIN")/bunx" ]; then ln -sf "$(dirname "$BUN_BIN")/bunx" "$HOME/.local/bin/bunx" 2>/dev/null || true; fi',
  '"$BUN_BIN" --version >/dev/null',
].join("\\n");

async function ensureBunAvailable(sandbox: SandboxSession) {
  const result = await sandbox.run({ command: ensureBunAvailableScript });
  if (result.exitCode !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join("\\n").trim();
    throw new Error(\`Failed to prepare Bun in ASH sandbox: \${output || "unknown error"}\`);
  }
}

function shellEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || "/home/vercel-sandbox";
  return {
    ...process.env,
    BUN_INSTALL: \`\${home}/.bun\`,
    HOME: home,
    PATH: [
      \`\${home}/.bun/bin\`,
      \`\${home}/.local/bin\`,
      "/usr/local/bin",
      "/vercel/runtimes/node24/bin",
      "/vercel/runtimes/node22/bin",
      "/vercel/runtimes/nodejs/bin",
      "/usr/bin",
      "/bin",
      process.env.PATH || "",
    ]
      .filter(Boolean)
      .join(":"),
  };
}

async function runHostShell(
  command: string,
  cwd = workspaceRoot,
  abortSignal?: AbortSignal
): Promise<SandboxCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
      signal: abortSignal,
      cwd,
      env: shellEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (error) {
    const failure = error as {
      code?: unknown;
      message?: string;
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: String(failure.stdout || ""),
      stderr: String(failure.stderr || failure.message || ""),
    };
  }
}

function emptyReadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function bufferToStream(content: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(content);
      controller.close();
    },
  });
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength);
}

function nodeStreamToWeb(stream: Readable | null): ReadableStream<Uint8Array> {
  if (!stream) return emptyReadableStream();
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

function resolveWorkspacePath(input: string): string {
  if (!input || input === ".") {
    return workspaceRoot;
  }

  if (input === workspaceRoot) {
    return workspaceRoot;
  }

  if (input.startsWith(\`\${workspaceRoot}/\`)) {
    return path.join(workspaceRoot, input.slice(workspaceRoot.length + 1));
  }

  if (path.isAbsolute(input)) {
    return input;
  }

  return path.join(workspaceRoot, input);
}

function resolveWorkingDirectory(input?: string): string {
  return resolveWorkspacePath(input || workspaceRoot);
}

async function pathExists(input: string): Promise<boolean> {
  try {
    await access(input, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function prepareWorkspace() {
  if (!projectRoot) {
    throw new Error("DEV3000_PROJECT_ROOT is required for the dev3000 ASH sandbox backend.");
  }

  const mkdirResult = await runHostShell(
    [
      "set -e",
      \`sudo mkdir -p \${workspaceRoot}\`,
      \`sudo chown "$(id -u):$(id -g)" \${workspaceRoot}\`,
    ].join("\\n"),
    "/",
  );
  if (mkdirResult.exitCode !== 0) {
    throw new Error(\`Failed to prepare ASH workspace: \${mkdirResult.stderr || mkdirResult.stdout || "unknown error"}\`);
  }

  await ensureBunAvailable(createHostSession("bootstrap"));

  const repoPath = path.join(workspaceRoot, "repo");
  if (await pathExists(repoPath)) {
    await rm(repoPath, { force: true, recursive: true });
  }
  await symlink(projectRoot, repoPath, "dir");
}

function sliceTextByLines(text: string, options?: SandboxReadTextFileOptions): string {
  if (!options?.startLine && !options?.endLine) {
    return text;
  }

  const lines = text.split("\\n");
  const start = Math.max((options.startLine || 1) - 1, 0);
  const end = options.endLine && options.endLine > 0 ? options.endLine : lines.length;
  return lines.slice(start, end).join("\\n");
}

function templatePath(templateKey: string): string {
  return path.join(templateStoreDir, \`\${templateKey.replace(/[^a-zA-Z0-9_-]/g, "-")}.json\`);
}

async function writeTemplateSeedFiles(
  templateKey: string,
  seedFiles: readonly { content: string | Buffer; path: string }[]
) {
  await mkdir(templateStoreDir, { recursive: true });
  await writeFile(
    templatePath(templateKey),
    JSON.stringify(
      {
        version: 1,
        seedFiles: seedFiles.map((file) => ({
          path: file.path,
          contentBase64: Buffer.from(file.content).toString("base64"),
        })),
      },
      null,
      2,
    ),
  );
}

async function readTemplateSeedFiles(templateKey: string | null): Promise<Array<{ content: Buffer; path: string }>> {
  if (!templateKey) return [];

  try {
    const payload = JSON.parse(await readFile(templatePath(templateKey), "utf8")) as {
      seedFiles?: Array<{ contentBase64?: unknown; path?: unknown }>;
      version?: unknown;
    };

    if (payload.version !== 1 || !Array.isArray(payload.seedFiles)) return [];
    return payload.seedFiles.flatMap((file) => {
      if (typeof file.path !== "string" || typeof file.contentBase64 !== "string") return [];
      return [{ path: file.path, content: Buffer.from(file.contentBase64, "base64") }];
    });
  } catch {
    return [];
  }
}

async function writeSeedFiles(session: SandboxSession, seedFiles: readonly { content: Buffer; path: string }[]) {
  for (const file of seedFiles) {
    await session.writeBinaryFile({ path: file.path, content: file.content });
  }
}

function spawnHostShell(options: SandboxSpawnOptions): SandboxProcess {
  const child = spawnProcess("bash", ["-lc", options.command], {
    cwd: resolveWorkingDirectory(options.workingDirectory),
    env: shellEnv(),
    signal: options.abortSignal,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const waitPromise = new Promise<{ exitCode: number }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ exitCode: typeof code === "number" ? code : 1 });
    });
  });

  return {
    stdout: nodeStreamToWeb(child.stdout),
    stderr: nodeStreamToWeb(child.stderr),
    async wait() {
      return waitPromise;
    },
    async kill() {
      child.kill();
      await waitPromise.catch(() => undefined);
    },
  };
}

function createHostSession(id: string): SandboxSession {
  return {
    id,
    resolvePath: resolveWorkspacePath,
    run: (options: SandboxRunOptions) =>
      runHostShell(options.command, resolveWorkingDirectory(options.workingDirectory), options.abortSignal),
    spawn: (options: SandboxSpawnOptions) => Promise.resolve(spawnHostShell(options)),
    async readFile(options) {
      try {
        return bufferToStream(await readFile(resolveWorkspacePath(options.path)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async readBinaryFile(options) {
      try {
        return await readFile(resolveWorkspacePath(options.path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async readTextFile(options: SandboxReadTextFileOptions) {
      try {
        const content = await readFile(resolveWorkspacePath(options.path), "utf8");
        return sliceTextByLines(content, options);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async writeFile(options: SandboxWriteFileOptions) {
      const resolved = resolveWorkspacePath(options.path);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, await streamToBuffer(options.content));
    },
    async writeBinaryFile(options) {
      const resolved = resolveWorkspacePath(options.path);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, options.content);
    },
    async writeTextFile(options) {
      const resolved = resolveWorkspacePath(options.path);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, options.content, { encoding: (options.encoding || "utf8") as BufferEncoding });
    },
    async removePath(options) {
      await rm(resolveWorkspacePath(options.path), {
        force: options.force,
        recursive: options.recursive,
      });
    },
    async setNetworkPolicy() {
      // dev3000's host-backed sandbox runs in the workflow sandbox itself, so network policy is owned by that outer sandbox.
    },
  };
}

function hostFilesystemBackend(): SandboxBackend {
  return {
    name: "dev3000-host-filesystem",
    async prewarm(input) {
      await writeTemplateSeedFiles(input.templateKey, input.seedFiles);
      return { reused: false };
    },
    async create(input) {
      await prepareWorkspace();
      const session = createHostSession(input.sessionKey);
      await writeSeedFiles(session, await readTemplateSeedFiles(input.templateKey));

      return {
        session,
        useSessionFn: async () => session,
        async captureState() {
          return {
            backendName: "dev3000-host-filesystem",
            metadata: { workspaceRoot },
            sessionKey: input.sessionKey,
          };
        },
        async dispose() {},
      };
    },
  };
}

export default defineSandbox({
  backend: hostFilesystemBackend(),
  async onSession({ use }) {
    const sandbox = await use();
    await ensureBunAvailable(sandbox);

    const repoCheck = await sandbox.run({ command: "test -d /workspace/repo && test -f /workspace/repo/package.json" });
    if (repoCheck.exitCode !== 0) {
      throw new Error("ASH sandbox workspace is missing /workspace/repo.");
    }
  },
});
`
}

function renderGeneratedWorkspaceReadme(): string {
  return `# dev3000 Generated Workspace

- The live project is available at \`/workspace/repo\`.
- Packaged skills are available under \`/workspace/skills\`.
- When editing the application code, operate inside \`/workspace/repo\` so changes land in the real project checkout.
`
}

function renderWorkflowWorldLocalPatchScript(): string {
  return `import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

let worldEntry;
try {
  worldEntry = require.resolve("@workflow/world");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
    console.log("workflow world-local schema patch skipped: @workflow/world is not installed");
    process.exit(0);
  }
  throw error;
}

const runsPath = path.join(path.dirname(worldEntry), "runs.js");
const targets = [runsPath];

const bundledLibsPath = path.join(process.cwd(), ".output", "server", "_libs");
if (existsSync(bundledLibsPath)) {
  const pending = [bundledLibsPath];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    for (const entry of readdirSync(current)) {
      const next = path.join(current, entry);
      const stat = statSync(next);
      if (stat.isDirectory()) {
        pending.push(next);
      } else if (/\\.[cm]?js$/.test(entry)) {
        targets.push(next);
      }
    }
  }
}

// @workflow/world-local writes undefined run fields to JSON, which removes
// the keys. The @workflow/world run schema must accept those absent keys.
let patchedCount = 0;
let alreadyPatchedCount = 0;

for (const filePath of targets) {
  const source = readFileSync(filePath, "utf8");
  const patched = source.replace(
    /(output|error|completedAt): z\\.undefined\\(\\)(?!\\.optional\\(\\)),/g,
    "$1: z.undefined().optional(),",
  );

  if (patched !== source) {
    writeFileSync(filePath, patched);
    patchedCount += 1;
    continue;
  }

  if (/(output|error|completedAt): z\\.undefined\\(\\)\\.optional\\(\\),/.test(source)) {
    alreadyPatchedCount += 1;
  }
}

if (patchedCount === 0) {
  if (alreadyPatchedCount === 0) {
    throw new Error("Failed to patch @workflow/world run schema.");
  }
  console.log("workflow world-local schema patch already applied");
} else {
  console.log(\`patched @workflow/world run schema in \${patchedCount} file(s)\`);
}
`
}

function renderGeneratedAgentDefinition(input: DevAgentAshInput): string {
  const preferredModel = escapeTypeScriptString(formatAiAgent(input.aiAgent))

  return `import { createGateway } from "ai";
import { defineAgent } from "experimental-ash";

const preferredModel = "${preferredModel}";
const explicitOidcToken = process.env.VERCEL_OIDC_TOKEN?.trim() || "";
const explicitApiKey = process.env.AI_GATEWAY_API_KEY?.trim() || "";

const gateway = explicitOidcToken
  ? createGateway({
      apiKey: explicitOidcToken,
      headers: {
        "ai-gateway-auth-method": "oidc",
      },
    })
  : explicitApiKey
    ? createGateway({
        apiKey: explicitApiKey,
      })
    : createGateway();

const runtimeModel = gateway.languageModel(preferredModel);
const [provider = "gateway", ...modelIdParts] = preferredModel.split("/");
const resolvedModelId = modelIdParts.length > 0 ? modelIdParts.join("/") : preferredModel;
const model = Object.create(runtimeModel);

Object.defineProperties(model, {
  provider: {
    value: provider,
    enumerable: true,
  },
  modelId: {
    value: resolvedModelId,
    enumerable: true,
  },
});

export default defineAgent({
  description: "${escapeTypeScriptString(input.description.trim())}",
  model,
});
`
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

${renderDeepSecRuntimeNotes(input)}

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
  const packagedSkills = [...packagedSkillData.packagedSkills, "dev3000-agent-runbook"]
  const disabledFrameworkTools = isDeepSecAshInput(input)
    ? [
        {
          path: "agent/tools/read_file.ts",
          content: renderDisabledFrameworkTool()
        },
        {
          path: "agent/tools/write_file.ts",
          content: renderDisabledFrameworkTool()
        }
      ]
    : []
  const disabledAutomationTools = getDisabledAutomationToolFiles()
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
            "patch-workflow-world": "node scripts/patch-workflow-world-local.mjs",
            typecheck: "tsgo"
          },
          dependencies: {
            ai: ASH_AI_PACKAGE_VERSION,
            [ASH_PACKAGE_NAME]: ASH_PACKAGE_VERSION,
            zod: "^4.3.6"
          },
          devDependencies: {
            "@types/node": "^24.12.2",
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
            skipLibCheck: true,
            types: ["node"]
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
      content: renderGeneratedAgentDefinition(input)
    },
    {
      path: "agent/instructions.md",
      content: systemPrompt
    },
    {
      path: "agent/instructions/runtime-contract.md",
      content: renderRuntimeContractLayer(input)
    },
    {
      path: "agent/instructions/evaluation.md",
      content: renderEvaluationLayer(input)
    },
    {
      path: "agent/instructions/skills.md",
      content: renderSkillsLayer(input)
    },
    {
      path: "agent/channels/ash.ts",
      content: renderAshRuntimeMessageChannel()
    },
    {
      path: "agent/channels/dev3000.ts",
      content: renderAshRuntimeTaskChannel()
    },
    {
      path: "agent/sandbox/sandbox.ts",
      content: renderGeneratedSandboxDefinition()
    },
    {
      path: "agent/sandbox/workspace/README.md",
      content: renderGeneratedWorkspaceReadme()
    },
    {
      path: "scripts/patch-workflow-world-local.mjs",
      content: renderWorkflowWorldLocalPatchScript()
    },
    {
      path: "agent/spec.json",
      content: JSON.stringify(canonicalSpec, null, 2)
    },
    {
      path: "agent/skills-manifest.json",
      content: JSON.stringify(
        {
          packagedSkills
        },
        null,
        2
      )
    },
    {
      path: "agent/skills/dev3000-agent-runbook/SKILL.md",
      content: renderExecutionRunbookSkill(input)
    },
    ...disabledAutomationTools,
    ...disabledFrameworkTools,
    ...packagedSkillData.files
  ]

  return {
    packageName,
    packageVersion,
    systemPrompt,
    sourceLabel,
    specHash,
    packagedSkills,
    compiledSpec: canonicalSpec,
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
    systemPrompt,
    compiledSpec: canonicalSpec
  }
}

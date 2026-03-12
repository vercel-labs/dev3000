import { list, put } from "@vercel/blob"

const FETCH_TIMEOUT_MS = 6000
const FETCH_RETRIES = 2

const CUSTOM_RECIPE_PREFIX = "recipes/custom/"
const RECIPE_STATS_PREFIX = "recipes/stats/"

const BUILTIN_RECIPE_ID_ALIASES = {
  "recipe-cls-fix": "r_c84m2f",
  "recipe-design-guidelines": "r_d91q7k",
  "recipe-react-performance": "r_p47n6x",
  "recipe-turbopack-bundle-analyzer": "r_t62v8m",
  "recipe-custom-prompt": "r_u35h9c"
} as const

export type RecipeKind = "builtin" | "custom"
export type RecipeExecutionMode = "dev-server" | "preview-pr"
export type RecipeSandboxBrowser = "none" | "agent-browser" | "next-browser"

export interface RecipeAuthor {
  id: string
  email: string
  name: string
  username: string
}

export interface RecipeEditor {
  id: string
  email: string
}

export interface RecipeSkillRef {
  id: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl?: string
}

export interface Recipe {
  id: string
  kind: RecipeKind
  name: string
  description: string
  instructions: string
  executionMode: RecipeExecutionMode
  sandboxBrowser: RecipeSandboxBrowser
  skillRefs: RecipeSkillRef[]
  author: RecipeAuthor
  createdAt: string
  updatedAt: string
  usageCount: number
  legacyWorkflowType?: "cls-fix" | "prompt" | "design-guidelines" | "react-performance" | "turbopack-bundle-analyzer"
  supportsPathInput?: boolean
  supportsPullRequest?: boolean
  supportsCrawlDepth?: boolean
  requiresCustomPrompt?: boolean
}

interface StoredRecipe extends Omit<Recipe, "usageCount" | "sandboxBrowser"> {
  sandboxBrowser?: RecipeSandboxBrowser
}

interface RecipeUsageStat {
  recipeId: string
  usageCount: number
  updatedAt: string
}

async function fetchJsonWithRetry(fetchUrl: string): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(fetchUrl, {
        headers: {
          Accept: "application/json"
        },
        cache: "no-store",
        signal: controller.signal
      })
      clearTimeout(timeout)
      return response
    } catch (error) {
      clearTimeout(timeout)
      lastError = error
      if (attempt < FETCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
  }

  throw lastError
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function canonicalizeRecipeId(recipeId: string): string {
  return BUILTIN_RECIPE_ID_ALIASES[recipeId as keyof typeof BUILTIN_RECIPE_ID_ALIASES] ?? recipeId
}

function generateRecipeId(): string {
  return `r_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
}

function titleCaseSkillName(skillName: string): string {
  return skillName
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function parseRecipeSkillRef(input: {
  installArg: string
  sourceUrl?: string
  displayName?: string
}): RecipeSkillRef {
  const installArg = input.installArg.trim()
  const packageAndSkill = installArg.split("@")
  const packageName = packageAndSkill.length > 1 ? packageAndSkill.slice(0, -1).join("@") : undefined
  const rawSkillName = packageAndSkill.length > 1 ? packageAndSkill[packageAndSkill.length - 1] : installArg
  const normalizedSkillName = rawSkillName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")

  return {
    id: normalizedSkillName || slugify(installArg),
    installArg,
    packageName,
    skillName: normalizedSkillName || slugify(installArg),
    displayName: input.displayName?.trim() || titleCaseSkillName(normalizedSkillName || rawSkillName),
    sourceUrl: input.sourceUrl?.trim() || undefined
  }
}

const systemAuthor: RecipeAuthor = {
  id: "system",
  email: "system@dev3000.ai",
  name: "dev3000",
  username: "dev3000"
}

const BUILTIN_RECIPES: Array<Omit<Recipe, "usageCount">> = [
  {
    id: "r_c84m2f",
    kind: "builtin",
    name: "CLS Fix",
    description: "Capture layout shift problems in a sandboxed dev server, fix them, and verify the result.",
    instructions:
      "Use d3k runtime signals to find and fix cumulative layout shift issues. Capture before and after state, make targeted edits, and verify the page is stable before finishing.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseRecipeSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "cls-fix",
    supportsPathInput: true,
    supportsPullRequest: true
  },
  {
    id: "r_d91q7k",
    kind: "builtin",
    name: "Design Guidelines Review",
    description: "Audit a project against design guidelines, apply fixes, and prepare a PR-ready result.",
    instructions:
      "Review the selected project against the loaded design guidance, fix the highest-value issues, and validate that the experience is improved before finalizing.",
    executionMode: "preview-pr",
    sandboxBrowser: "next-browser",
    skillRefs: [
      parseRecipeSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      }),
      parseRecipeSkillRef({
        installArg: "vercel-labs/agent-skills@web-design-guidelines",
        sourceUrl: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "design-guidelines",
    supportsPathInput: true,
    supportsPullRequest: true,
    supportsCrawlDepth: true
  },
  {
    id: "r_p47n6x",
    kind: "builtin",
    name: "React Performance Review",
    description: "Find expensive React and Next.js patterns, apply fixes, and validate the performance direction.",
    instructions:
      "Capture a performance baseline, inspect the codebase for expensive React and Next.js patterns, apply targeted optimizations, and verify the impact before finishing.",
    executionMode: "preview-pr",
    sandboxBrowser: "next-browser",
    skillRefs: [
      parseRecipeSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      }),
      parseRecipeSkillRef({
        installArg: "vercel-labs/agent-skills@vercel-react-best-practices",
        sourceUrl: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "react-performance",
    supportsPathInput: true,
    supportsPullRequest: true
  },
  {
    id: "r_t62v8m",
    kind: "builtin",
    name: "Turbopack Bundle Analyzer",
    description: "Generate analyzer output, inspect the heaviest routes, and ship targeted bundle reductions.",
    instructions:
      "Generate the Turbopack analyzer artifacts, identify the largest route and bundle regressions, and make improvements that materially reduce shipped JavaScript before opening a PR.",
    executionMode: "preview-pr",
    sandboxBrowser: "none",
    skillRefs: [
      parseRecipeSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      }),
      parseRecipeSkillRef({
        installArg: "vercel-labs/skills@analyze-bundle",
        sourceUrl: "https://skills.sh/vercel-labs/skills/analyze-bundle"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "turbopack-bundle-analyzer",
    supportsPullRequest: true
  },
  {
    id: "r_u35h9c",
    kind: "builtin",
    name: "Custom Prompt",
    description: "Provide one-off instructions for a project and run them with the selected repo context.",
    instructions:
      "Use the supplied custom prompt as the primary task, load the d3k skill first, and complete the request against the selected project with evidence-backed validation.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseRecipeSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "prompt",
    supportsPathInput: true,
    supportsPullRequest: true,
    requiresCustomPrompt: true
  }
]

async function readJsonBlob<T>(pathname: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix: pathname })
    const blob = blobs.find((item) => item.pathname === pathname)
    if (!blob) {
      return null
    }

    const response = await fetchJsonWithRetry(blob.url)
    if (!response.ok) {
      return null
    }

    const contentType = response.headers.get("content-type")
    if (contentType && !contentType.includes("application/json")) {
      return null
    }

    return (await response.json()) as T
  } catch (error) {
    console.error(`[Recipes] Failed to read blob ${pathname}:`, error)
    return null
  }
}

async function listJsonBlobs<T>(prefix: string): Promise<T[]> {
  try {
    const { blobs } = await list({ prefix })
    const parsed: Array<T | null> = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const response = await fetchJsonWithRetry(blob.url)
          if (!response.ok) {
            return null
          }
          const contentType = response.headers.get("content-type")
          if (contentType && !contentType.includes("application/json")) {
            return null
          }
          return (await response.json()) as T
        } catch (error) {
          console.error(`[Recipes] Failed to fetch ${blob.pathname}:`, error)
          return null
        }
      })
    )

    return parsed.filter((value): value is T => value !== null)
  } catch (error) {
    console.error(`[Recipes] Failed to list blobs for ${prefix}:`, error)
    return []
  }
}

async function listRecipeUsageStats(): Promise<Map<string, number>> {
  const stats = await listJsonBlobs<RecipeUsageStat>(RECIPE_STATS_PREFIX)
  return new Map(stats.map((item) => [item.recipeId, item.usageCount]))
}

function getDefaultSandboxBrowser(executionMode: RecipeExecutionMode): RecipeSandboxBrowser {
  return executionMode === "preview-pr" ? "next-browser" : "agent-browser"
}

function normalizeRecipe(recipe: StoredRecipe | Omit<Recipe, "usageCount">): Omit<Recipe, "usageCount"> {
  const sandboxBrowser = recipe.sandboxBrowser
  return {
    ...recipe,
    id: canonicalizeRecipeId(recipe.id),
    sandboxBrowser:
      sandboxBrowser && isRecipeSandboxBrowser(sandboxBrowser)
        ? sandboxBrowser
        : getDefaultSandboxBrowser(recipe.executionMode)
  }
}

function applyUsageCounts(recipes: Array<Omit<Recipe, "usageCount">>, usageMap: Map<string, number>): Recipe[] {
  return recipes
    .map((recipe) => ({
      ...recipe,
      usageCount: usageMap.get(recipe.id) ?? 0
    }))
    .sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount
      return a.name.localeCompare(b.name)
    })
}

export async function listRecipes(): Promise<Recipe[]> {
  const [usageMap, customRecipes] = await Promise.all([listRecipeUsageStats(), listCustomRecipes()])
  const mergedRecipes = new Map<string, Omit<Recipe, "usageCount">>()

  for (const recipe of BUILTIN_RECIPES) {
    mergedRecipes.set(recipe.id, normalizeRecipe(recipe))
  }

  for (const recipe of customRecipes.map(normalizeRecipe)) {
    const existing = mergedRecipes.get(recipe.id)
    if (!existing || new Date(recipe.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      mergedRecipes.set(recipe.id, recipe)
    }
  }

  return applyUsageCounts(Array.from(mergedRecipes.values()), usageMap)
}

export async function listCustomRecipes(): Promise<StoredRecipe[]> {
  return listJsonBlobs<StoredRecipe>(CUSTOM_RECIPE_PREFIX)
}

export async function getRecipe(recipeId: string): Promise<Recipe | null> {
  const canonicalRecipeId = canonicalizeRecipeId(recipeId)
  const usageMap = await listRecipeUsageStats()
  const candidateCustomRecipes = await Promise.all([
    readJsonBlob<StoredRecipe>(`${CUSTOM_RECIPE_PREFIX}${recipeId}.json`),
    canonicalRecipeId !== recipeId
      ? readJsonBlob<StoredRecipe>(`${CUSTOM_RECIPE_PREFIX}${canonicalRecipeId}.json`)
      : null
  ])
  const customRecipe = candidateCustomRecipes
    .filter((value): value is StoredRecipe => value !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]

  if (customRecipe) {
    return {
      ...normalizeRecipe(customRecipe),
      usageCount: usageMap.get(canonicalRecipeId) ?? usageMap.get(recipeId) ?? 0
    }
  }

  const builtin = BUILTIN_RECIPES.find((recipe) => recipe.id === canonicalRecipeId)
  if (builtin) {
    return {
      ...normalizeRecipe(builtin),
      usageCount: usageMap.get(canonicalRecipeId) ?? usageMap.get(recipeId) ?? 0
    }
  }

  return null
}

export async function createCustomRecipe(input: {
  name: string
  description: string
  instructions: string
  executionMode: RecipeExecutionMode
  sandboxBrowser: RecipeSandboxBrowser
  skillRefs: RecipeSkillRef[]
  author: RecipeAuthor
}): Promise<Recipe> {
  const id = generateRecipeId()
  const now = new Date().toISOString()
  const storedRecipe: StoredRecipe = {
    id,
    kind: "custom",
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: input.instructions.trim(),
    executionMode: input.executionMode,
    sandboxBrowser: input.sandboxBrowser,
    skillRefs: input.skillRefs,
    author: input.author,
    createdAt: now,
    updatedAt: now,
    supportsPathInput: true,
    supportsPullRequest: true
  }

  await put(`${CUSTOM_RECIPE_PREFIX}${id}.json`, JSON.stringify(storedRecipe, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  return {
    ...normalizeRecipe(storedRecipe),
    usageCount: 0
  }
}

export async function updateCustomRecipe(
  recipeId: string,
  input: {
    name: string
    description: string
    instructions: string
    executionMode: RecipeExecutionMode
    sandboxBrowser: RecipeSandboxBrowser
    skillRefs: RecipeSkillRef[]
    author: RecipeAuthor
  }
): Promise<Recipe | null> {
  const canonicalRecipeId = canonicalizeRecipeId(recipeId)
  const existingRecipe = await getRecipe(recipeId)
  if (!existingRecipe) {
    return null
  }

  const updatedRecipe: StoredRecipe = {
    ...existingRecipe,
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: input.instructions.trim(),
    executionMode: input.executionMode,
    sandboxBrowser: input.sandboxBrowser,
    skillRefs: input.skillRefs,
    author: input.author,
    updatedAt: new Date().toISOString()
  }

  await put(`${CUSTOM_RECIPE_PREFIX}${canonicalRecipeId}.json`, JSON.stringify(updatedRecipe, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  const usageMap = await listRecipeUsageStats()
  return {
    ...normalizeRecipe(updatedRecipe),
    usageCount: usageMap.get(canonicalRecipeId) ?? usageMap.get(recipeId) ?? 0
  }
}

export async function incrementRecipeUsage(recipeId: string): Promise<void> {
  const canonicalRecipeId = canonicalizeRecipeId(recipeId)
  const current = await readJsonBlob<RecipeUsageStat>(`${RECIPE_STATS_PREFIX}${canonicalRecipeId}.json`)
  const nextUsageCount = (current?.usageCount ?? 0) + 1
  const payload: RecipeUsageStat = {
    recipeId: canonicalRecipeId,
    usageCount: nextUsageCount,
    updatedAt: new Date().toISOString()
  }

  await put(`${RECIPE_STATS_PREFIX}${canonicalRecipeId}.json`, JSON.stringify(payload, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
  })
}

export function isRecipeExecutionMode(value: string): value is RecipeExecutionMode {
  return value === "dev-server" || value === "preview-pr"
}

export function isRecipeSandboxBrowser(value: string): value is RecipeSandboxBrowser {
  return value === "none" || value === "agent-browser" || value === "next-browser"
}

export function canEditRecipe(recipe: Recipe, user: RecipeEditor): boolean {
  if (recipe.author.id && user.id && recipe.author.id === user.id) {
    return true
  }

  if (recipe.author.email && user.email && recipe.author.email === user.email) {
    return true
  }

  return (
    recipe.author.id === "system" || recipe.author.username === "dev3000" || recipe.author.email === "system@dev3000.ai"
  )
}

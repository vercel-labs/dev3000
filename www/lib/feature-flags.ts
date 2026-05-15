import { createVercelAdapter, getProviderData as getVercelProviderData } from "@flags-sdk/vercel"
import { flag } from "flags/next"
import { DEV3000_URL } from "@/lib/constants"
import type { VercelTeam } from "@/lib/vercel-teams"

const DEV_AGENTS_ENABLED_KEY = "dev-agents-enabled"

const devAgentsEnabledOptions = [
  { value: false, label: "Disabled" },
  { value: true, label: "Enabled" }
]

const devAgentsEnabledDescription = "Show and enable the Dev Agents product surfaces."

type FeatureFlagEntities = {
  team?: {
    id: string
    isPersonal: boolean
    plan?: string
    slug: string
  }
}

function createDefaultVercelAdapter() {
  if (!process.env.FLAGS) return null

  try {
    return createVercelAdapter(process.env.FLAGS)
  } catch (error) {
    console.warn("[Flags] Failed to initialize Vercel Flags adapter", error)
    return null
  }
}

const defaultVercelAdapter = createDefaultVercelAdapter()

function getTeamEntity(team: VercelTeam | undefined): FeatureFlagEntities["team"] {
  if (!team) return undefined
  return {
    id: team.id,
    isPersonal: team.isPersonal,
    plan: team.planLabel,
    slug: team.slug
  }
}

const devAgentsEnabledFlagDefinition = {
  key: DEV_AGENTS_ENABLED_KEY,
  defaultValue: false,
  description: devAgentsEnabledDescription,
  options: devAgentsEnabledOptions
}

export const devAgentsEnabledFlag = defaultVercelAdapter
  ? flag<boolean, FeatureFlagEntities>({
      ...devAgentsEnabledFlagDefinition,
      adapter: defaultVercelAdapter<boolean, FeatureFlagEntities>()
    })
  : flag<boolean, FeatureFlagEntities>({
      ...devAgentsEnabledFlagDefinition,
      decide: () => false,
      origin: `${DEV3000_URL}/admin`
    })

export async function isDevAgentsEnabled(team?: VercelTeam): Promise<boolean> {
  return devAgentsEnabledFlag.run({
    identify: {
      team: getTeamEntity(team)
    }
  })
}

const fallbackDefinitions = {
  [DEV_AGENTS_ENABLED_KEY]: {
    defaultValue: false,
    declaredInCode: true,
    description: devAgentsEnabledDescription,
    origin: `${DEV3000_URL}/admin`,
    options: devAgentsEnabledOptions
  },
  "demo-cls-bugs": {
    description: "Enable intentional CLS bugs for demo purposes",
    origin: DEV3000_URL,
    options: devAgentsEnabledOptions
  }
}

export async function getFeatureFlagProviderData() {
  if (!defaultVercelAdapter) {
    return {
      definitions: fallbackDefinitions,
      hints: []
    }
  }

  try {
    const vercelProviderData = await getVercelProviderData({ devAgentsEnabledFlag })
    return {
      definitions: {
        ...fallbackDefinitions,
        ...vercelProviderData.definitions
      },
      hints: vercelProviderData.hints
    }
  } catch (error) {
    return {
      definitions: fallbackDefinitions,
      hints: [
        {
          key: "vercel-flags-provider",
          text: `Vercel Flags definitions could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`
        }
      ]
    }
  }
}

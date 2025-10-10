import { createFlagsDiscoveryEndpoint } from "flags/next"
import { demoCLSBugsFlag } from "@/lib/flags"

export const GET = createFlagsDiscoveryEndpoint(async () => ({
  definitions: {
    [demoCLSBugsFlag.key]: {
      description: demoCLSBugsFlag.description,
      origin: demoCLSBugsFlag.origin,
      options: demoCLSBugsFlag.options
    }
  }
}))

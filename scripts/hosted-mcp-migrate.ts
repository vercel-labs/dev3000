import { createHostedAuth } from "../www/lib/hosted/auth"
import { sessionSchema } from "../www/lib/hosted/sandbox"
import { getMigrations } from "../www/node_modules/better-auth/dist/db/get-migration.mjs"

// Operator-only migration. Never expose a public migration/administration endpoint.
const { auth, database } = createHostedAuth()
try {
  const plan = await getMigrations(auth.options)
  await plan.runMigrations()
  await database.query(sessionSchema)
  console.log("Hosted MCP schema is ready")
} finally {
  await database.end()
}

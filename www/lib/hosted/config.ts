export interface HostedProject {
  slug: string
  teamId: string
  projectId: string
}

export function hostedConfig(env: Record<string, string | undefined> = process.env) {
  const required = (name: string) => {
    const value = env[name]
    if (!value) throw new Error(`Hosted MCP is not configured: missing ${name}`)
    return value
  }
  const origin = required("D3K_HOSTED_ORIGIN")
  const url = new URL(origin)
  if (url.protocol !== "https:" || url.origin !== origin) throw new Error("Expected an HTTPS hosted origin")
  const secret = required("D3K_HOSTED_AUTH_SECRET")
  if (secret.length < 32) throw new Error("Hosted auth secret must have at least 32 characters")
  const projects = JSON.parse(required("D3K_HOSTED_PROJECTS")) as HostedProject[]
  if (
    !Array.isArray(projects) ||
    projects.length === 0 ||
    projects.some(
      (project) =>
        !/^[\w.-]+\/[\w.-]+$/.test(project.slug) ||
        !/^team_[\w]+$/.test(project.teamId) ||
        !/^prj_[\w]+$/.test(project.projectId)
    )
  )
    throw new Error("Expected an explicit hosted project allowlist")
  return {
    origin,
    resource: `${origin}/mcp`,
    issuer: `${origin}/api/mcp-auth`,
    secret,
    allowedUser: required("D3K_HOSTED_ALLOWED_VERCEL_USER_ID"),
    clientId: required("D3K_HOSTED_CLIENT_ID"),
    clientSecret: required("D3K_HOSTED_CLIENT_SECRET"),
    databaseUrl: required("D3K_HOSTED_DATABASE_URL"),
    vercelToken: required("D3K_HOSTED_VERCEL_TOKEN"),
    projects
  }
}

export function admittedVercelIdentity(provider: unknown, subject: unknown, allowedUser: string): boolean {
  return provider === "vercel" && typeof subject === "string" && subject === allowedUser
}

export function selectedProject(projects: HostedProject[], slug: string): HostedProject {
  const project = projects.find((candidate) => candidate.slug === slug)
  if (!project) throw new Error("This project is not enabled for the hosted pilot")
  return project
}

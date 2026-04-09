interface AdminUserLike {
  email?: string | null
  username?: string | null
}

function parseConfiguredAdmins(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

const DEFAULT_ADMIN_USERNAMES = ["elsigh"]

export function isAdminUser(user: AdminUserLike | null | undefined): boolean {
  if (!user) return false

  const configuredEmails = parseConfiguredAdmins(process.env.DEV3000_ADMIN_EMAILS)
  const configuredUsernames = [
    ...DEFAULT_ADMIN_USERNAMES,
    ...parseConfiguredAdmins(process.env.DEV3000_ADMIN_USERNAMES)
  ]

  const email = user.email?.trim().toLowerCase()
  const username = user.username?.trim().toLowerCase()

  if (email && configuredEmails.includes(email)) {
    return true
  }

  if (username && configuredUsernames.includes(username)) {
    return true
  }

  return false
}

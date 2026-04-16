interface AdminUserLike {
  id?: string | null
}

const ADMIN_USER_ID = "9AkWCo9wv4rsq4i103sKeFrg"

export function isAdminUser(user: AdminUserLike | null | undefined): boolean {
  return user?.id === ADMIN_USER_ID
}

export function formatBuildVersion(version: string, buildStamp?: string | null): string {
  const normalizedBuildStamp = buildStamp?.trim()
  if (!version.includes("-canary") || !normalizedBuildStamp) {
    return version
  }

  return `${version}+${normalizedBuildStamp}`
}

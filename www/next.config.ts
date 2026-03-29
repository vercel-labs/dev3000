import type { NextConfig } from "next"
import path from "path"
import { fileURLToPath } from "url"
import { withWorkflow } from "workflow/next"

const currentDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  typedRoutes: true,
  cacheComponents: true,
  compress: process.env.NODE_ENV === "production",
  experimental: {
    turbopackFileSystemCacheForDev: true,
    varyParams: true,
    optimisticRouting: true
  },
  outputFileTracingRoot: path.join(currentDir, ".."),
  turbopack: {
    root: path.join(currentDir, "..")
  }
}

export default withWorkflow(nextConfig)

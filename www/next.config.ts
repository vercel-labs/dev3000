import createWithVercelToolbar from "@vercel/toolbar/plugins/next"
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
  experimental: {
    turbopackFileSystemCacheForDev: true
  },
  outputFileTracingRoot: path.join(currentDir, ".."),
  turbopack: {
    root: path.join(currentDir, "..")
  }
}

const withVercelToolbar = createWithVercelToolbar()
export default withWorkflow(withVercelToolbar(nextConfig))

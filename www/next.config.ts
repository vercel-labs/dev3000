import createWithVercelToolbar from "@vercel/toolbar/plugins/next"
import type { NextConfig } from "next"
import path from "path"
import { fileURLToPath } from "url"

const currentDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  experimental: {
    turbopackFileSystemCacheForDev: true,
    typedRoutes: true,
    cacheComponents: true
  },
  outputFileTracingRoot: path.join(currentDir, ".."),
  turbopack: {
    root: path.join(currentDir, "..")
  }
}

const withVercelToolbar = createWithVercelToolbar()
export default withVercelToolbar(nextConfig)

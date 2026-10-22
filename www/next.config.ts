import type { NextConfig } from "next"
import path from "path"
import { fileURLToPath } from "url"

const currentDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  compress: process.env.NODE_ENV === "production",
  outputFileTracingRoot: path.join(currentDir, ".."),
  turbopack: {
    root: path.join(currentDir, "..")
  }
}

export default nextConfig

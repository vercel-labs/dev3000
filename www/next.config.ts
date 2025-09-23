import type { NextConfig } from "next"
import path from "path"
import { fileURLToPath } from "url"

const currentDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { reactCompiler: true, turbopackPersistentCaching: true },
  outputFileTracingRoot: path.join(currentDir, ".."),
  turbopack: {
    root: path.join(currentDir, "..")
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  }
}

export default nextConfig

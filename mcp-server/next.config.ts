import type { NextConfig } from "next"
import path from "path"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { reactCompiler: true, turbopackPersistentCaching: true },
  devIndicators: false,
  turbopack: {
    root: path.join(__dirname, "..")
  },
  // Optimize for minimal MCP server
  eslint: {
    ignoreDuringBuilds: true
  },
  // Disable image optimization to avoid sharp dependency issues
  images: {
    unoptimized: true
  }
}

export default nextConfig

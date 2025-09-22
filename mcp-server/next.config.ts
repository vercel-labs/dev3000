import type { NextConfig } from "next"
import path from "path"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { reactCompiler: true },
  devIndicators: false,
  turbopack: {
    root: path.join(__dirname, "..")
  },
  // Optimize for minimal MCP server
  eslint: {
    ignoreDuringBuilds: true
  }
}

export default nextConfig

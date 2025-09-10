import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { reactCompiler: true },
  output: "standalone",
  devIndicators: false,
  turbopack: {
    root: __dirname
  },
  // Optimize for minimal MCP server
  eslint: {
    ignoreDuringBuilds: true
  }
}

export default nextConfig

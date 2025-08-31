import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    turbo: {}
  },
  // Optimize for minimal MCP server
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
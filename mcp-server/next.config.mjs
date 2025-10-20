import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  experimental: { turbopackFileSystemCacheForDev: true },
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

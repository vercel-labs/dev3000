import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  // Cache Components enabled for Next.js 16.0.0-canary.18
  // Note: In stable 16.0.0, this would be inside experimental: {}
  // In canary versions, cacheComponents is at root level
  cacheComponents: true,
  experimental: { turbopackFileSystemCacheForDev: true },
  devIndicators: false,
  turbopack: {
    root: path.join(__dirname, "..")
  },
  // Disable image optimization to avoid sharp dependency issues
  images: {
    unoptimized: true
  }
}

export default nextConfig

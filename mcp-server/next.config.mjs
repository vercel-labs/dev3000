import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  experimental: {
    turbopackFileSystemCacheForDev: true,
    viewTransition: true
  },
  devIndicators: false,
  // Disable image optimization to avoid sharp dependency issues
  images: {
    unoptimized: true
  }
}

export default nextConfig

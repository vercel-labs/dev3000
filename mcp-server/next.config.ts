import type { NextConfig } from "next"

const nextConfig: NextConfig = {
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

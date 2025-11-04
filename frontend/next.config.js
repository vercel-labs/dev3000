/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reduce dev double-render overhead while keeping prod strict checks
  reactStrictMode: process.env.NODE_ENV !== 'development',
  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Image optimization disabled for faster Docker builds
  images: {
    unoptimized: true,
  },

  // Disable x-powered-by header for security
  poweredByHeader: false,

  // Development indicators
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right'
  },

  // Performance optimizations
  experimental: {
    // Optimize package imports for better tree-shaking
    optimizePackageImports: ['react', 'react-dom'],
    // Enable CSS chunking for better performance (Next.js 16+)
    cssChunking: 'strict',
    // Note: Turbopack filesystem cache flags require latest canary of Next.js.
    // Keep disabled on stable to avoid startup failures.
  },

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true
    }
  },

  // TypeScript configuration
  typescript: {
    // Enable type checking during build
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig

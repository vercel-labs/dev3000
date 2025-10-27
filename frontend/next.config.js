/** @type {import('next').NextConfig} */
const nextConfig = {
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

  // Experimental features for performance optimization
  experimental: {
    optimizePackageImports: ['react', 'react-dom'],
    // Enable optimistic client cache for faster navigation
    optimisticClientCache: true,
    // Enable CSS chunking for better performance
    optimizeCss: true,
  },

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true
    }
  },

  // Build output directory
  distDir: '.next',

  // TypeScript configuration
  typescript: {
    // Enable type checking during build
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig

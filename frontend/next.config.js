/** @type {import('next').NextConfig} */
const nextConfig = {
  // Performance optimizations

  // SWC compiler optimizations
  swcMinify: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Image optimization disabled for faster Docker builds
  images: {
    unoptimized: true,
  },

  // Disable x-powered-by header
  poweredByHeader: false,

  // Development indicators
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right'
  },

  // Experimental features for performance
  experimental: {
    // Enable optimized package imports
    optimizePackageImports: ['react', 'react-dom'],

    // Turbopack configuration (when using --turbopack flag)
    turbo: {
      // Use memory cache for faster rebuilds
      memoryLimit: 1024 * 1024 * 1024, // 1GB
    },
  },

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true
    }
  },

  // Output configuration for faster builds
  output: 'standalone',
}

module.exports = nextConfig

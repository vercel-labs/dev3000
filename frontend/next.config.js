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

  // Experimental features
  experimental: {
    // Enable optimized package imports for better tree-shaking
    optimizePackageImports: ['react', 'react-dom'],

    // Enable Turbopack for faster development builds
    turbo: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },

    // Optimize server component data streaming
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true
    }
  },

  // Output configuration
  output: 'standalone',

  // TypeScript configuration
  typescript: {
    // Enable type checking during build
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig

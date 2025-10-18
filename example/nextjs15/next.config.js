/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable turbopack for faster development builds
  // Note: Turbopack is automatically used with --turbopack flag in package.json

  // Experimental MCP server integration for dev3000
  experimental: {
    mcpServer: true
  },

  // Disable static optimization for development
  // This ensures all pages are server-rendered for better dev3000 monitoring
  devIndicators: {
    appIsrStatus: true,
    buildActivity: true,
    buildActivityPosition: 'bottom-right'
  },

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true
    }
  }
}

module.exports = nextConfig

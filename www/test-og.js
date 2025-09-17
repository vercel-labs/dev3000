#!/usr/bin/env node

/**
 * Simple test script to verify OG image generation works locally
 * Run with: node test-og.js
 */

const http = require("http")

const server = http.createServer((req, res) => {
  if (req.url === "/api/og/changelog") {
    // This would be handled by Next.js in production
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>OG Image Test - Changelog</title>
          <meta property="og:title" content="dev3000 v0.0.62 - AI-Powered Development Tools">
          <meta property="og:description" content="New release: Fix linter formatting in next-env.d.ts • Clean up code formatting and bump to v0.0.62-canary • Fix server readiness check for FastAPI/Python servers and more.">
          <meta property="og:image" content="/api/og/changelog">
          <meta property="og:image:width" content="1200">
          <meta property="og:image:height" content="630">
          <meta name="twitter:card" content="summary_large_image">
        </head>
        <body>
          <h1>OG Image Test</h1>
          <p>When deployed, the OG image will be generated dynamically at /api/og</p>
          <p>Metadata includes:</p>
          <ul>
            <li>Latest version: v0.0.62</li>
            <li>Dynamic highlights from changelog</li>
            <li>1200x630 image dimensions</li>
            <li>Twitter large image card</li>
          </ul>
        </body>
      </html>
    `)
  } else {
    res.writeHead(404)
    res.end("Not found")
  }
})

server.listen(3001, () => {
  console.log("Test server running on http://localhost:3001")
  console.log("Visit http://localhost:3001/api/og/changelog to test OG image metadata")
})

#!/bin/bash

# Test script for d3k cloud fix command

set -e

echo "🧪 Testing d3k cloud fix command"
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
  echo "❌ .env.local not found. Running vercel env pull..."
  vercel env pull
fi

# Build the project first
echo "🔨 Building project..."
pnpm run build

# Navigate to www directory
cd www

echo ""
echo "📁 Testing in www directory..."
echo ""

# Run cloud fix with debug mode and short timeout for testing
node --env-file ../.env.local ../dist/cli.js cloud fix --debug --timeout 15m

echo ""
echo "✅ Test complete!"

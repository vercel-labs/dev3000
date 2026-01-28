#!/bin/bash
# Script to attempt claiming the 'd3k' package name on npm
# Run: npm login first, then ./scripts/claim-d3k-npm.sh

set -e

echo "🔍 Checking if 'd3k' is available on npm..."

# Check if the package already exists
if npm view d3k > /dev/null 2>&1; then
  echo "❌ Package 'd3k' already exists on npm!"
  npm view d3k
  exit 1
fi

echo "✅ Package 'd3k' does not exist yet. Attempting to claim it..."

# Create a temporary directory
TEMP_DIR=$(mktemp -d)
echo "📁 Working in: $TEMP_DIR"

cd "$TEMP_DIR"

# Create a minimal package.json
cat > package.json << 'EOF'
{
  "name": "d3k",
  "version": "0.0.1",
  "description": "AI-powered development environment - placeholder for upcoming release",
  "keywords": ["ai", "development", "dev-tools", "claude", "agents"],
  "author": "Vercel Labs",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/vercel-labs/dev3000"
  },
  "homepage": "https://github.com/vercel-labs/dev3000",
  "bin": {
    "d3k": "./placeholder.js"
  }
}
EOF

# Create a placeholder script
cat > placeholder.js << 'EOF'
#!/usr/bin/env node
console.log("d3k is coming soon! For now, use: npx dev3000");
console.log("Visit: https://github.com/vercel-labs/dev3000");
EOF

# Create a minimal README
cat > README.md << 'EOF'
# d3k

AI-powered development environment.

**Coming soon!** For now, use:

```bash
npx dev3000
```

Visit [github.com/vercel-labs/dev3000](https://github.com/vercel-labs/dev3000) for more info.
EOF

echo "📦 Package contents:"
ls -la
echo ""
cat package.json
echo ""

echo "🚀 Attempting to publish..."
npm publish --access public

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Successfully claimed 'd3k' on npm!"
  echo "🔗 https://www.npmjs.com/package/d3k"
else
  echo ""
  echo "❌ Failed to publish. Check the error above."
fi

# Cleanup
cd -
rm -rf "$TEMP_DIR"

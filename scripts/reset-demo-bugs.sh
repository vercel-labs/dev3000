#!/bin/bash

# Reset script for demo-apps-with-bugs directory
# This script resets all changes in the demo apps back to their original buggy state

set -e

DEMO_DIR="demo-apps-with-bugs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEMO_PATH="$PROJECT_ROOT/$DEMO_DIR"

echo "🔄 Resetting demo apps with bugs..."

if [ ! -d "$DEMO_PATH" ]; then
    echo "❌ Demo directory not found at: $DEMO_PATH"
    echo "💡 Make sure you're running this from the dev3000 project root"
    exit 1
fi

echo "📍 Working in: $DEMO_PATH"

# Go back to project root to work with the main git repo
cd "$PROJECT_ROOT"

echo "📋 Checking git status for demo apps..."

# Check if there are any changes in the demo directory to reset
if git diff --quiet -- "$DEMO_DIR" && git diff --cached --quiet -- "$DEMO_DIR"; then
    echo "✨ No changes to reset - demo apps are already in original state"
else
    echo "🔄 Resetting all changes in $DEMO_DIR to HEAD..."
    
    # Reset any staged changes in demo directory
    git reset HEAD -- "$DEMO_DIR"
    
    # Reset any working directory changes in demo directory
    git checkout -- "$DEMO_DIR"
    
    # Clean any untracked files in demo directory (except .gitignore'd files)
    git clean -fd "$DEMO_DIR"
    
    echo "✅ All changes in $DEMO_DIR have been reset!"
    echo "📊 Current status for demo apps:"
    git status --short -- "$DEMO_DIR"
fi

echo ""
echo "🎯 Demo apps are now reset to their original buggy state!"
echo "🚀 You can now run 'dev3000' in any of the demo app directories to test debugging"
echo ""
echo "Available demo apps:"
for app_dir in */; do
    if [ -d "$app_dir" ]; then
        app_name=$(basename "$app_dir")
        echo "  • $app_name/ - $([ -f "$app_dir/package.json" ] && echo "$(cd "$app_dir" && node -pe "require('./package.json').description || 'Next.js app with intentional bugs'")" || echo "Demo application")"
    fi
done

echo ""
echo "💡 Remember: These apps contain intentional bugs for testing dev3000's debugging capabilities!"
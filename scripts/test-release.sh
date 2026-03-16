#!/bin/bash
set -e

echo "🧪 Running release checks..."

echo "🔍 Running lint..."
bun run lint

echo "🧠 Running typecheck..."
bun run typecheck

echo "🧪 Running unit tests..."
bun run test

echo "✨ Release checks passed."
echo "Package is ready for release."

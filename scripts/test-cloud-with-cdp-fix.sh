#!/bin/bash

# Test cloud fix command with CDP fix
cd "$(dirname "$0")/../www" || exit 1

# Export token from .env.local
export VERCEL_OIDC_TOKEN=$(grep VERCEL_OIDC_TOKEN .env.local | cut -d'"' -f2)

# Run cloud fix
node ../dist/cli.js cloud fix --timeout 20m

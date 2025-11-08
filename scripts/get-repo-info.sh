#!/bin/bash

# Script to extract GitHub repository information from a local directory
# Usage: ./scripts/get-repo-info.sh [directory]

DIR="${1:-.}"

if [ ! -d "$DIR" ]; then
  echo "Error: Directory '$DIR' does not exist" >&2
  exit 1
fi

cd "$DIR" || exit 1

# Traverse up to find .git directory (handles monorepo subdirectories)
ORIGINAL_DIR=$(pwd)
GIT_ROOT=""

while [[ "$(pwd)" != "/" ]]; do
  if [ -d ".git" ]; then
    GIT_ROOT=$(pwd)
    break
  fi
  cd ..
done

if [ -z "$GIT_ROOT" ]; then
  echo "Error: No git repository found in '$ORIGINAL_DIR' or any parent directory" >&2
  exit 1
fi

cd "$GIT_ROOT" || exit 1

# Get the remote URL
REMOTE_URL=$(git config --get remote.origin.url)

if [ -z "$REMOTE_URL" ]; then
  echo "Error: No remote origin found" >&2
  exit 1
fi

# Extract owner and repo name from various GitHub URL formats
# Supports: git@github.com:owner/repo.git, https://github.com/owner/repo.git, https://github.com/owner/repo
if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
  REPO_OWNER="${BASH_REMATCH[1]}"
  REPO_NAME="${BASH_REMATCH[2]}"
else
  echo "Error: Could not parse GitHub repository from remote URL: $REMOTE_URL" >&2
  exit 1
fi

# Get current branch
BRANCH=$(git branch --show-current)

if [ -z "$BRANCH" ]; then
  # Fallback for detached HEAD state
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
fi

# Get default branch (usually main or master)
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

if [ -z "$DEFAULT_BRANCH" ]; then
  # If that doesn't work, try to get it from git remote
  DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | cut -d' ' -f5)
fi

if [ -z "$DEFAULT_BRANCH" ]; then
  # Final fallback
  DEFAULT_BRANCH="main"
fi

# Output as JSON
cat <<EOF
{
  "repoOwner": "$REPO_OWNER",
  "repoName": "$REPO_NAME",
  "currentBranch": "$BRANCH",
  "defaultBranch": "$DEFAULT_BRANCH",
  "remoteUrl": "$REMOTE_URL"
}
EOF

#!/bin/bash
# Script to run MoodMatch backend server with live reload and environment variables

# Source the .env file to load environment variables
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Change directory to MoodMatch before running server
cd "$(dirname "$0")"

# Run the backend server with tsx
npx tsx server/index.ts

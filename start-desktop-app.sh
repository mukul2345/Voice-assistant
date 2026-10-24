#!/bin/bash

set -euo pipefail

if [ ! -d "node_modules" ]; then
    echo "Dependencies are missing. Run: npm install"
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "Configuration is missing. Copy .env.example to .env and set JWT_SECRET plus an AI provider key."
    exit 1
fi

echo "Starting Interview Copilot in development mode."
echo "Electron will wait for the local backend health check; existing port owners will not be terminated."
exec npm run electron:dev

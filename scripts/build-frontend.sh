#!/bin/bash
# DSHmini frontend build: tokens codegen + vite → apps/macos/Resources/web
set -euo pipefail
cd "$(dirname "$0")/.."
node frontend/packages/design/gen-tokens.mjs
if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm install --no-audit --no-fund)
fi
(cd frontend && npm run build)
echo "OK: frontend/dist"

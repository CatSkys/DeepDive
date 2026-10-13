#!/bin/bash
# DSHmini frontend build: vite → apps/macos/Resources/web
# （token codegen 归 `npm run build`——写在这里就多一处、且漏掉别的构建腿）
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm install --no-audit --no-fund)
fi
(cd frontend && npm run build)
echo "OK: frontend/dist"

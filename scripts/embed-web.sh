#!/bin/sh
# Embed the built SPA into the app bundle (Contents/Resources/web).
# XcodeGen copies groups flat, which breaks vite's ../assets/ layout, so the
# shell scripts copy the dist tree verbatim after the build.
set -e
cd "$(dirname "$0")/.."
APP="${1:?usage: embed-web.sh <path/to/DSHmini.app>}"
mkdir -p "$APP/Contents/Resources/web"
rm -rf "$APP/Contents/Resources/web"/*
cp -R frontend/dist/. "$APP/Contents/Resources/web/"
echo "OK: embedded web into $APP"

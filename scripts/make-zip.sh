#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="release"
OUT_FILE="$OUT_DIR/yshop-itemshop-license-suite.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

zip -r "$OUT_FILE" \
  README.md \
  package.json \
  .gitignore \
  scripts \
  apps \
  -x "*/node_modules/*" "*/.env" "*/data/*" "release/*" ".git/*"

echo "ZIP gotowy: $OUT_FILE"

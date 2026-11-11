#!/usr/bin/env bash
# Rebuild every 3D model in the bank: USDZ, GLB and poster PNG.
# Usage: tools/models/build.sh [model-name ...]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$here/../../.work"
venv="$work/venv"

if [ ! -x "$venv/bin/python" ]; then
  python3 -m venv "$venv"
fi
"$venv/bin/pip" install -q -r "$here/requirements.txt"

if [ ! -f "$work/render/node_modules/three/package.json" ]; then
  mkdir -p "$work/render"
  (cd "$work/render" && npm init -y >/dev/null && npm install --no-audit --no-fund three@0.169.0)
fi

"$venv/bin/python" "$here/build.py" "$@"
node "$here/render_posters.mjs" "$@"

#!/bin/sh
# User-local install of the OpenCode 2 plugin SDK so
#   import { define } from "@opencode-ai/plugin/v2/promise"
# resolves. package.json is gitignored in this repo.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
export TMPDIR="${TMPDIR:-$HOME/tmp}"
mkdir -p "$TMPDIR" "$ROOT/node_modules/@opencode-ai"
PLUGIN_VER="${OPENCODE_PLUGIN_VERSION:-0.0.0-beta-18955}"
JSON5_VER="${JSON5_VERSION:-2.2.3}"
PKG_CLI="${PKG_CLI:-/usr/bin/npm}"
REG="${PLUGIN_REGISTRY:-https://registry.npmjs.org}"

if [ ! -f "$ROOT/package.json" ]; then
  printf '%s\n' '{"name":"opencode-config-local","private":true,"type":"module"}' > "$ROOT/package.json"
fi

extract_tarball() {
  url="$1"
  dest="$2"
  tgz="$TMPDIR/$(basename "$dest").tgz"
  curl -fsSL -o "$tgz" "$url"
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  stage="$TMPDIR/extract-$(basename "$dest")"
  rm -rf "$stage"
  mkdir -p "$stage"
  tar -xzf "$tgz" -C "$stage"
  mv "$stage/package" "$dest"
  rm -rf "$stage"
}

if [ -x "$PKG_CLI" ]; then
  (cd "$ROOT" && "$PKG_CLI" install --no-fund --no-audit \
    "@opencode-ai/plugin@${PLUGIN_VER}" "json5@${JSON5_VER}")
else
  echo "package CLI missing; fetching registry tarballs" >&2
  extract_tarball \
    "$REG/@opencode-ai/plugin/-/plugin-${PLUGIN_VER}.tgz" \
    "$ROOT/node_modules/@opencode-ai/plugin"
  extract_tarball \
    "$REG/json5/-/json5-${JSON5_VER}.tgz" \
    "$ROOT/node_modules/json5"
fi

python3 - "$ROOT/node_modules/@opencode-ai/plugin/package.json" << 'PY2'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
d = json.loads(p.read_text())
exports = d.setdefault("exports", {})
if "./v2/promise" not in exports:
    exports["./v2/promise"] = {
        "import": "./dist/promise/plugin.js",
        "types": "./dist/promise/plugin.d.ts",
    }
    p.write_text(json.dumps(d, indent=2) + "\n")
    print("added exports[./v2/promise]")
PY2

mkdir -p "$ROOT/node_modules/@opencode-ai/plugin/dist/v2"
printf '%s\n' 'export { define } from "../promise/plugin.js";' \
  > "$ROOT/node_modules/@opencode-ai/plugin/dist/v2/promise.js"

test -f "$ROOT/node_modules/@opencode-ai/plugin/package.json"
test -f "$ROOT/node_modules/json5/package.json"
echo "ok: @opencode-ai/plugin@${PLUGIN_VER} and json5@${JSON5_VER} in $ROOT/node_modules"

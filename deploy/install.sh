#!/usr/bin/env bash
# Install threads-mcp-cli from source and register it with Claude Code.
#
# For the npm route, or any other client, see the README. This exists for the
# case the README cannot cover in one paste: a clone, a build, and a client
# pointed at an absolute path.
set -euo pipefail

REPO="${THREADS_MCP_REPO:-https://github.com/thenavidm/threads-mcp-cli.git}"
DIR="${THREADS_MCP_DIR:-$HOME/.local/share/threads-mcp}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}

need git
need node
need npm

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "Node 20 or newer is required. Found $(node -v)." >&2
  exit 1
fi

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "Cloning into $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
npm install
npm run build

echo
echo "Built at $DIR/dist/index.js"
echo

if [ -z "${THREADS_APP_ID:-}" ] || [ -z "${THREADS_APP_SECRET:-}" ]; then
  cat <<'MSG'
Next, authorise a profile. You need a Meta app first:

  1. developers.facebook.com/apps, Create App, Threads API use case
  2. Copy the Threads App ID and App Secret
  3. Add http://127.0.0.1:8788/callback as a redirect URI
  4. Add yourself as a Threads Tester, and accept the invite from
     your Threads profile under Settings, Website permissions

Then:

  export THREADS_APP_ID=...
  export THREADS_APP_SECRET=...
  node "$DIR/dist/index.js" login

MSG
else
  echo "Authorising..."
  node "$DIR/dist/index.js" login
fi

if command -v claude >/dev/null 2>&1; then
  echo "Registering with Claude Code..."
  claude mcp add threads -- node "$DIR/dist/index.js"
  echo "Done. Check it with: node $DIR/dist/index.js doctor"
else
  cat <<MSG
Point your MCP client at:

  node $DIR/dist/index.js

Check the setup with:

  node $DIR/dist/index.js doctor
MSG
fi

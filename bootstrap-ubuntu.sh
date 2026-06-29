#!/usr/bin/env bash
set -euo pipefail

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  echo "Cannot detect Linux distribution: /etc/os-release is missing." >&2
  exit 1
fi

case "${ID:-}" in
  ubuntu|debian) ;;
  *)
    if [[ " ${ID_LIKE:-} " != *" debian "* ]]; then
      echo "This bootstrap script supports Ubuntu/Debian only. Install Node.js 20+ and pnpm manually on ${PRETTY_NAME:-this system}." >&2
      exit 1
    fi
    ;;
esac

node_major="0"
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
fi

if [ "${node_major}" -ge 20 ] && command -v pnpm >/dev/null 2>&1; then
  echo "Node.js $(node --version) and pnpm $(pnpm --version) are already available."
  exit 0
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "Root or sudo is required to install Node.js 20+ automatically." >&2
  exit 1
fi

${SUDO} apt-get update
${SUDO} apt-get install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | ${SUDO} bash -
${SUDO} apt-get install -y nodejs

if command -v corepack >/dev/null 2>&1; then
  ${SUDO} corepack enable
  ${SUDO} corepack prepare pnpm@latest --activate
else
  ${SUDO} npm install -g pnpm
fi

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "${node_major}" -lt 20 ]; then
  echo "Node.js 20+ installation failed. Current: $(node --version)" >&2
  exit 1
fi

echo "Bootstrap complete: Node.js $(node --version), pnpm $(pnpm --version)"

#!/usr/bin/env bash
set -Eeuo pipefail

# One-time server bootstrap for a fresh Ubuntu/Debian host.
# Installs Docker Engine + Compose plugin, clones the project, and prints next steps.
#
# Usage (as root or with sudo):
#   curl -fsSL <your-project-url>/server-setup.sh | bash
#   # or locally:
#   bash scripts/server-setup.sh
#
# After it finishes: configure .env.prod, then run ./scripts/deploy.sh

set -x

# --- 1. System packages ------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release git

# --- 2. Docker Engine (official install script) ------------------------------
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# --- 3. Compose plugin --------------------------------------------------------
if ! docker compose version >/dev/null 2>&1; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  COMPOSE_VERSION="$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+' | head -1)"
  curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

# --- 4. Start Docker -----------------------------------------------------------
systemctl enable --now docker 2>/dev/null || service docker start || true

# --- 5. Project checkout --------------------------------------------------------
# Default checkout path; override with PROJECT_DIR=/path.
PROJECT_DIR="${PROJECT_DIR:-/opt/arbitrage-scanner}"
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  mkdir -p "$(dirname "$PROJECT_DIR")"
  if [[ -n "${GIT_REPO_URL:-}" ]]; then
    git clone "$GIT_REPO_URL" "$PROJECT_DIR"
  else
    echo "GIT_REPO_URL not set — project source must be uploaded to $PROJECT_DIR manually."
    echo "  mkdir -p $PROJECT_DIR && rsync -av --exclude node_modules --exclude .git ./ user@host:$PROJECT_DIR/"
  fi
fi

set +x

echo ""
echo "=========================================================="
echo " Server bootstrap complete."
echo " Next steps:"
echo "   1) cd $PROJECT_DIR"
echo "   2) cp .env.prod.example .env.prod   # fill in secrets"
echo "   3) ./scripts/deploy.sh"
echo "=========================================================="

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed."
    echo "Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

echo "Installing ansible dependencies..."
uv sync

echo
echo "Configuring ansible..."
uv run python ansible_setup.py

echo
echo "Installing ansible galaxy requirements..."
uv run ansible-galaxy install -r requirements.yml

echo
echo "Done! Run ansible with: uv run ansible-playbook <playbook.yml>"

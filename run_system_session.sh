#!/bin/bash
# Run system_session.py in a virtual environment (avoids Homebrew "externally-managed-environment").
set -e
cd "$(dirname "$0")"
VENV_DIR=".venv-system-session"
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating venv at $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
pip install -q -r requirements-system-session.txt
python system_session.py

#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a
exec python3 "$(dirname "$0")/proxy.py"

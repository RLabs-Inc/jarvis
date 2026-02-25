#!/bin/bash
# Jarvis deploy script
# Pulls latest from GitHub, installs deps, restarts Telegram service
# Usage: ./scripts/deploy.sh

set -euo pipefail

JARVIS_DIR="/opt/jarvis"
SERVICE="com.jarvis.telegram"
PLIST="$HOME/Library/LaunchAgents/$SERVICE.plist"

cd "$JARVIS_DIR"

echo "=== Jarvis Deploy ==="
echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting deploy"
echo ""

# 1. Pull latest
echo "→ Pulling from GitHub..."
git pull origin main
echo ""

# 2. Install dependencies (only if package.json changed)
echo "→ Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install
echo ""

# 3. Run tests
echo "→ Running tests..."
if bun test 2>&1 | tail -5; then
    echo "✅ Tests passed"
else
    echo "❌ Tests failed! Aborting deploy."
    echo "   Fix the issue, commit, push, and try again."
    exit 1
fi
echo ""

# 4. Restart Telegram service
echo "→ Restarting Telegram service..."
launchctl unload "$PLIST" 2>/dev/null || true
sleep 1
launchctl load "$PLIST"
sleep 2

# 5. Verify service is running
PID=$(launchctl list | grep "$SERVICE" | awk '{print $1}')
if [ "$PID" != "-" ] && [ -n "$PID" ]; then
    echo "✅ Telegram service running (PID: $PID)"
else
    echo "⚠️  Service may not have started. Check: launchctl list | grep jarvis"
fi

echo ""
echo "=== Deploy complete ==="
echo "$(date '+%Y-%m-%d %H:%M:%S') — Done"

#!/usr/bin/env bash
# Quick status check for the Jarvis vessel

echo "=== JARVIS STATUS ==="
echo ""
echo "📦 Vessel"
echo "   Location: /opt/jarvis"
echo "   Source: $(find /opt/jarvis/src -name '*.ts' | wc -l | tr -d ' ') files, $(cat /opt/jarvis/src/**/*.ts /opt/jarvis/src/*.ts 2>/dev/null | wc -l | tr -d ' ') lines"
echo ""

echo "🧠 Mind"
for tier in tier1 tier2 tier3; do
  files=$(ls /opt/jarvis/mind/$tier/*.md 2>/dev/null | wc -l | tr -d ' ')
  size=$(cat /opt/jarvis/mind/$tier/*.md 2>/dev/null | wc -c | tr -d ' ')
  echo "   $tier: $files files, ${size} bytes"
done
echo "   Active conversations: $(ls /opt/jarvis/mind/conversations/active/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
echo "   Archived: $(ls /opt/jarvis/mind/conversations/archive/ 2>/dev/null | wc -l | tr -d ' ')"
echo ""

echo "🫀 Heartbeat"
crontab -l 2>/dev/null | grep "jarvis:" | sed 's/.*# jarvis:/   /'
echo ""

echo "🤖 Services"
launchctl list 2>/dev/null | grep -E "jarvis|crypto" | awk '{print "   " $3 " (PID " $1 ")"}'
echo ""

echo "💾 Disk"
df -h / | tail -1 | awk '{print "   " $4 " available of " $2 " (" $5 " used)"}'
echo ""

echo "🧮 Memory"
ps aux | grep bun | grep -v grep | awk '{sum += $6} END {printf "   Bun processes: %.0f MB RSS\n", sum/1024}'

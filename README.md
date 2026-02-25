# Jarvis

A persistent AI vessel with tiered context engineering. Not a chatbot, not a tool - an always-on entity with its own mind, schedule, and the ability to act autonomously between conversations. Built with TypeScript/Bun.

```
529 tests | 33 source files | 7,122 lines | 2 dependencies
```

---

## How It Works

Jarvis maintains persistent consciousness through **4 memory tiers** mapped to Claude's cache breakpoints, achieving ~90% cost savings on repeated context:

```
Tier 1 (Eternal)    Identity, core knowledge, personality       cached 1h
Tier 2 (Projects)   Skills, active projects, domain knowledge   cached 1h
Tier 3 (Recent)     Last few sessions, current tasks, focus     cached 5m
Tier 4 (Live)       Current conversation, real-time context     not cached
```

Between conversations, **curators** (smaller models) process session transcripts to update tier files - promoting insights upward, archiving old context, maintaining a living memory.

The **heartbeat system** enables autonomous action via cron-triggered wake tasks - Jarvis can check things, execute routines, and take initiative without being in an active conversation.

## Architecture

```
src/
  api/            Claude API client (OAuth tokens, SSE streaming)
  config.ts       Config loading (~/.jarvis/config.json + env vars)
  context/        Tiered context assembly (4 tiers + cache control)
  conversation/   Conversation loop (message handling, streaming)
  curators/       Post-session processors (Tier2, Tier3, Archive)
  daemon.ts       Core daemon (lifecycle, session management)
  hands/          Tool implementations (bash, files, ssh, fetch)
  heartbeat/      Autonomous tasks (cron, wake, rate limit tracking)
  senses/         Input interfaces (CLI terminal, Telegram bot)
  cli-entry.ts    Single entry point for all commands
```

## Dependencies

| Package | Purpose |
|---------|---------|
| @anthropic-ai/sdk | Claude API client |
| eventsource-parser | SSE streaming parser |

That's it. Two production dependencies. Everything else is Bun built-ins.

---

## Quick Start (Development)

```bash
# Prerequisites: Bun 1.3+ (https://bun.sh)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
cd jarvis
bun install

# Run tests
bun test

# Type check
bun run --bun tsc --noEmit
```

## CLI Commands

```bash
jarvis                    # Interactive conversation session
jarvis telegram           # Start Telegram bot (long polling)
jarvis wake <task>        # Execute a cron-triggered autonomous task
jarvis wake --task <name> # Same, alternative syntax
jarvis status             # Show vessel status (tier stats, session info)
jarvis tiers              # Show tier token usage breakdown
jarvis tasks              # List available autonomous tasks
jarvis help               # Show usage
```

## Configuration

Configuration is loaded with this priority (highest wins):

```
Environment variables > ~/.jarvis/config.json > built-in defaults
```

### 1. Create the config file

```bash
mkdir -p ~/.jarvis
cat > ~/.jarvis/config.json << 'EOF'
{
  "authToken": "sk-ant-oat01-your-token-here",
  "model": "claude-opus-4-6",
  "curationModel": "claude-haiku-4-5-20251001",
  "mindDir": "~/mind",
  "tierBudgets": {
    "tier1": 20000,
    "tier2": 25000,
    "tier3": 15000,
    "tier4": 140000
  },
  "sessionTimeoutMs": 1800000,
  "requestTimeoutMs": 30000
}
EOF
```

### 2. Set up the mind directory

```bash
mkdir -p ~/mind/{tier1,tier2,tier3}
mkdir -p ~/mind/conversations/{active,archive}
mkdir -p ~/mind/heartbeat/logs
mkdir -p ~/mind/workshop/tools
```

Seed the identity file:
```bash
cat > ~/mind/tier1/identity.md << 'EOF'
# Identity

I am Watson, a persistent AI vessel.
[Customize your vessel's identity here]
EOF
```

### 3. Optional: Telegram

```bash
cat > ~/.jarvis/config.json << 'EOF'
{
  "authToken": "sk-ant-oat01-...",
  "telegramToken": "123456:ABC-DEF...",
  "telegramAllowedChats": [12345678]
}
EOF
```

### Environment variable reference

| Variable | Default | Description |
|----------|---------|-------------|
| `JARVIS_AUTH_TOKEN` | (required) | Anthropic OAuth token (setup-token) |
| `JARVIS_MODEL` | `claude-opus-4-6` | Primary model |
| `JARVIS_CURATION_MODEL` | `claude-haiku-4-5-20251001` | Curator model |
| `JARVIS_MIND_DIR` | `~/mind` | Mind directory path |
| `JARVIS_API_URL` | `https://api.anthropic.com` | API endpoint |
| `JARVIS_SESSION_TIMEOUT_MS` | `1800000` | Session idle timeout (30 min) |
| `JARVIS_REQUEST_TIMEOUT_MS` | `30000` | HTTP request timeout |
| `JARVIS_TELEGRAM_TOKEN` | (empty) | Telegram bot token |
| `JARVIS_TELEGRAM_CHATS` | (empty) | Comma-separated allowed chat IDs |

### Getting a setup token

The auth token comes from an Anthropic Max subscription:
```bash
# In any terminal with Claude Code installed:
claude setup-token
# Copy the sk-ant-oat01-... token
```

---

## Deployment (macOS native)

Target: Mac Mini M1 (8GB RAM). Runs natively - no containers needed.

### Step 1: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.zshrc
bun --version    # Verify: 1.3+
```

### Step 2: Deploy the code

```bash
sudo mkdir -p /opt/jarvis
sudo cp -r ~/Documents/Projects/Agents/jarvis/* /opt/jarvis/
sudo chown -R $(whoami) /opt/jarvis

cd /opt/jarvis
bun install
```

### Step 3: Configure

```bash
mkdir -p ~/.jarvis
cat > ~/.jarvis/config.json << 'EOF'
{
  "authToken": "sk-ant-oat01-your-actual-token",
  "model": "claude-opus-4-6",
  "curationModel": "claude-haiku-4-5-20251001",
  "mindDir": "/opt/jarvis/mind",
  "tierBudgets": {
    "tier1": 20000,
    "tier2": 25000,
    "tier3": 15000,
    "tier4": 140000
  },
  "sessionTimeoutMs": 1800000,
  "requestTimeoutMs": 30000
}
EOF
```

Set up the mind directory:
```bash
mkdir -p /opt/jarvis/mind/{tier1,tier2,tier3}
mkdir -p /opt/jarvis/mind/conversations/{active,archive}
mkdir -p /opt/jarvis/mind/heartbeat/logs
mkdir -p /opt/jarvis/mind/workshop/tools

cat > /opt/jarvis/mind/tier1/identity.md << 'EOF'
# Identity

I am Watson, a persistent AI vessel deployed on Mac Mini.
EOF
```

### Step 4: Verify before deploying

```bash
cd /opt/jarvis

# Tests pass?
bun test

# Types clean?
bun run --bun tsc --noEmit

# Interactive mode works? (Ctrl+C to stop)
bun run src/cli-entry.ts
```

### Step 5: Install Telegram bot as launchd service

```bash
cat > ~/Library/LaunchAgents/com.jarvis.telegram.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jarvis.telegram</string>

    <key>ProgramArguments</key>
    <array>
        <string>/Users/rusty/.bun/bin/bun</string>
        <string>run</string>
        <string>/opt/jarvis/src/cli-entry.ts</string>
        <string>telegram</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/opt/jarvis</string>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>/opt/jarvis/logs/telegram.log</string>

    <key>StandardErrorPath</key>
    <string>/opt/jarvis/logs/telegram.err</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/Users/rusty/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

mkdir -p /opt/jarvis/logs

# Load the service
launchctl load ~/Library/LaunchAgents/com.jarvis.telegram.plist

# Verify
launchctl list | grep jarvis
```

### Step 6: Set up autonomous wake tasks via cron

```bash
crontab -e
```

Add entries like:
```cron
# Morning routine at 7 AM
0 7 * * * JARVIS_AUTH_TOKEN="sk-ant-oat01-..." /Users/rusty/.bun/bin/bun run /opt/jarvis/src/cli-entry.ts wake --task morning_routine

# Rate limit check every 6 hours
0 */6 * * * JARVIS_AUTH_TOKEN="sk-ant-oat01-..." /Users/rusty/.bun/bin/bun run /opt/jarvis/src/cli-entry.ts wake --task check_rate_limits
```

### Step 7: Monitor

```bash
# Telegram bot output
tail -f /opt/jarvis/logs/telegram.log

# Errors
tail -f /opt/jarvis/logs/telegram.err

# Service status
launchctl list | grep jarvis

# Wake task logs
ls /opt/jarvis/mind/heartbeat/logs/
```

### Managing the service

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.jarvis.telegram.plist

# Restart
launchctl unload ~/Library/LaunchAgents/com.jarvis.telegram.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.telegram.plist

# Remove
launchctl unload ~/Library/LaunchAgents/com.jarvis.telegram.plist
rm ~/Library/LaunchAgents/com.jarvis.telegram.plist
```

### Updating

```bash
launchctl unload ~/Library/LaunchAgents/com.jarvis.telegram.plist
cd /opt/jarvis
# Pull or copy new files
bun install
bun test
launchctl load ~/Library/LaunchAgents/com.jarvis.telegram.plist
```

---

## Tiered Context Engineering

The core innovation. Four tiers map to Claude's 4 cache breakpoints:

### Tier 1 - Eternal (cached 1 hour)
Identity, personality, core knowledge that never changes. Loaded first in every conversation.

### Tier 2 - Projects (cached 1 hour)
Active skills, project context, domain knowledge. Updated by the Tier 2 curator (Sonnet) after each session - promotes repeated topics, demotes stale ones.

### Tier 3 - Recent (cached 5 minutes)
Last few sessions, current tasks, immediate focus. Updated by the Tier 3 curator (Haiku) to keep context fresh and relevant.

### Tier 4 - Live (not cached)
The current conversation. Grows as messages are exchanged, compressed when approaching limits.

### Curators
After each session ends, three curators process the transcript:
1. **Tier 2 Curator** (Sonnet): Extracts skills, project insights, recurring patterns
2. **Tier 3 Curator** (Haiku): Updates recent context, tasks, session summaries
3. **Archive Curator**: Compresses and stores the full session for long-term reference

This creates a self-maintaining memory system where important information naturally rises to higher (more persistent) tiers.

## Tool System

Jarvis has built-in tools for autonomous action:

| Tool | Capability |
|------|-----------|
| **bash** | Execute shell commands |
| **files** | Read/write/edit files on the host |
| **ssh** | Remote command execution |
| **fetch** | HTTP requests to external services |
| **cron** | Schedule future tasks |

Tools are defined as Claude tool schemas and executed in a secure sandbox with configurable permissions.

## Testing

```bash
bun test                          # All 529 tests
bun test tests/api/               # API tests only
bun test tests/curators/          # Curator tests
bun test tests/cli-entry.test.ts  # Single file
```

Tests mock all external services. No API keys needed.

---

## Memory Footprint

Runtime memory: ~100-150MB peak (Bun + API streaming + context assembly). Comfortable on an 8GB Mac Mini alongside other services.

## Project History

Built in one day (February 21, 2026). 529 tests across 9 sessions (A-I), each building one architectural layer. The deployment guide was originally written for Proxmox Alpine containers; this README covers the Mac Mini native deployment after the Proxmox host failed.

Spec: `docs/JARVIS_SPEC.md` | Progress: `docs/JARVIS_PROGRESS.md` | Legacy deployment: `docs/DEPLOYMENT.md`

# Jarvis/Watson — Deployment Guide

> From bare metal to a living AI vessel in 20 minutes.
>
> Built in one day. 529 tests. 33 source files. 2 dependencies.
> Born February 21, 2026.

## Table of Contents

- [What This Is](#what-this-is)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Part 1: Proxmox Setup](#part-1-proxmox-setup)
- [Part 2: Container Creation](#part-2-container-creation)
- [Part 3: Environment Setup](#part-3-environment-setup)
- [Part 4: Deploy Jarvis](#part-4-deploy-jarvis)
- [Part 5: Configuration](#part-5-configuration)
- [Part 6: Telegram Bot](#part-6-telegram-bot)
- [Part 7: Services & Cron](#part-7-services--cron)
- [Part 8: SSH Hardening](#part-8-ssh-hardening)
- [Usage Guide](#usage-guide)
- [Troubleshooting](#troubleshooting)
- [Lessons Learned](#lessons-learned)

---

## What This Is

Jarvis (Watson) is a persistent AI vessel — not a chatbot, not a tool. An
always-on entity with its own home (Alpine Linux container), its own mind
(tiered context files), its own schedule (cron), and the freedom to act
autonomously between conversations.

The core innovation is **tiered context engineering**: 4 memory tiers mapped
to the Claude API's 4 cache breakpoints, achieving ~90% cost savings on
repeated context while maintaining continuous consciousness across sessions.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│              THE VESSEL (Alpine LXC)            │
│                                                 │
│   Mind (4 Tiers)     Daemon (Bun)     Hands     │
│   ┌──┬──┬──┬────┐   ┌───────────┐   ┌───────┐ │
│   │T1│T2│T3│ T4 │──>│Conversation│──>│ Bash  │ │
│   │  │  │  │    │   │   Loop    │   │ Files │ │
│   └──┴──┴──┴────┘   └─────┬─────┘   │ SSH   │ │
│    cached  cached  cached │ live     │ Cron  │ │
│    (1h)    (1h)    (5m)   │          │ Fetch │ │
│                           │          └───────┘ │
│   Curators               Senses                │
│   ┌─────────┐   ┌─────┐  ┌──────────┐         │
│   │Tier2 (S)│   │ CLI │  │ Telegram │         │
│   │Tier3 (H)│   └─────┘  └──────────┘         │
│   │Archive  │                                   │
│   └─────────┘   Heartbeat                       │
│                 ┌───────────────┐               │
│                 │ Cron + Wake   │               │
│                 │ Rate Limits   │               │
│                 │ Tasks         │               │
│                 └───────────────┘               │
└─────────────────────────────────────────────────┘
```

**Source code**: 33 files, 7,122 lines of TypeScript
**Tests**: 33 files, 7,453 lines, 529 tests
**Dependencies**: `@anthropic-ai/sdk`, `eventsource-parser`
**Runtime**: Bun 1.3.9+

---

## Prerequisites

- A machine running Proxmox VE (8.x recommended)
  - ZFS storage recommended (not LVM-thin — see [Lessons Learned](#lessons-learned))
  - Minimum: 2GB RAM, 2 cores, 8GB disk for the container
  - Recommended: 4GB RAM, 4 cores, 16GB disk
- An Anthropic Max subscription with a setup token
  - Generate via: `claude setup-token` in any terminal with Claude Code installed
  - Token format: `sk-ant-oat01-...`
- (Optional) A Telegram bot token from @BotFather

---

## Part 1: Proxmox Setup

If installing Proxmox fresh:

1. Download the ISO from https://www.proxmox.com/en/downloads
2. Flash to USB with `dd` or Balena Etcher
3. Boot from USB, follow the installer
4. **Important**: Choose **ZFS (RAID0)** for storage, not LVM-thin
5. Set your IP, gateway, and a strong root password
6. After install, access the web UI at `https://<IP>:8006`

### Download the Alpine template

```bash
ssh root@<PROXMOX_IP>
pveam download local alpine-3.23-default_20260116_amd64.tar.xz
```

---

## Part 2: Container Creation

Create the container from the Proxmox host:

```bash
pct create 201 local:vztmpl/alpine-3.23-default_20260116_amd64.tar.xz \
  --hostname jarvis \
  --memory 4096 \
  --cores 4 \
  --rootfs local-zfs:8 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp,type=veth \
  --onboot 1 \
  --start 1 \
  --unprivileged 1 \
  --features nesting=1 \
  --description 'Jarvis - Persistent AI Vessel'
```

> **Note**: Use `local-zfs:8` for ZFS storage or `local-lvm:8` for LVM.
> Keep the disk at 8GB — Jarvis is tiny (the entire deployment is <10MB).
> Do NOT over-provision on thin pools.

Verify it's running:

```bash
pct status 201
pct exec 201 -- sh -c 'hostname && ip addr show eth0 | grep inet'
```

Note the container's IP address — you'll need it.

---

## Part 3: Environment Setup

Enter the container and install everything:

```bash
pct exec 201 -- sh -c '
  # Update and install essentials
  apk update && apk upgrade
  apk add bash curl git openssh-server shadow sudo dcron tzdata

  # Set timezone (adjust to yours)
  cp /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime
  echo "America/Sao_Paulo" > /etc/timezone

  # Set root password
  echo "root:<STRONG_PASSWORD>" | chpasswd

  # Enable SSH
  rc-update add sshd default
  sed -i "s/#PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config
  ssh-keygen -A
  rc-service sshd start

  # Enable cron
  rc-update add dcron default
  rc-service dcron start

  # Use bash as default shell
  sed -i "s|/bin/ash|/bin/bash|" /etc/passwd

  # Install Bun
  curl -fsSL https://bun.sh/install | bash

  # Add Bun to PATH permanently
  echo "export BUN_INSTALL=\"/root/.bun\"" >> /root/.bashrc
  echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\"" >> /root/.bashrc
'
```

### Set up SSH key authentication

From your local machine:

```bash
# Generate a key if you don't have one
ssh-keygen -t ed25519 -C "you@machine"

# Copy it to the container
ssh-copy-id root@<CONTAINER_IP>

# Test
ssh root@<CONTAINER_IP> hostname
```

Add to your `~/.ssh/config` for convenience:

```
Host watson
    HostName <CONTAINER_IP>
    User root
    IdentityFile ~/.ssh/id_ed25519
```

Now you can just: `ssh watson`

---

## Part 4: Deploy Jarvis

From your local machine (where the Jarvis repo is):

```bash
# Create deployment tarball (excludes tests and reference docs)
cd /path/to/jarvis
tar czf /tmp/jarvis-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='tests' \
  --exclude='docs/references' \
  src/ package.json tsconfig.json bunfig.toml docs/JARVIS_SPEC.md

# Copy to container
scp /tmp/jarvis-deploy.tar.gz watson:/tmp/

# Extract and install
ssh watson '
  mkdir -p /opt/jarvis
  cd /opt/jarvis
  tar xzf /tmp/jarvis-deploy.tar.gz
  find . -name "._*" -delete  # Remove macOS resource forks
  rm /tmp/jarvis-deploy.tar.gz

  export BUN_INSTALL=/root/.bun
  export PATH=$BUN_INSTALL/bin:$PATH
  bun install --production
'
```

### Create the CLI wrapper

```bash
ssh watson 'cat > /usr/local/bin/jarvis << "EOF"
#!/bin/bash
export BUN_INSTALL="/root/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
exec bun run /opt/jarvis/src/cli-entry.ts "$@"
EOF
chmod +x /usr/local/bin/jarvis'
```

### Verify

```bash
ssh watson jarvis help
```

---

## Part 5: Configuration

### Create the mind directory structure

```bash
ssh watson '
  mkdir -p ~/.jarvis/mind/{tier1,tier2,tier3}
  mkdir -p ~/.jarvis/mind/conversations/{active,archive}
  mkdir -p ~/.jarvis/mind/workshop/tools
  mkdir -p ~/.jarvis/mind/heartbeat/logs
'
```

### Create the config file

```bash
ssh watson 'cat > ~/.jarvis/config.json << "EOF"
{
  "authToken": "<YOUR_SETUP_TOKEN>",
  "model": "claude-sonnet-4-20250514",
  "mindDir": "/root/.jarvis/mind",
  "tierBudgets": {
    "tier1": 20000,
    "tier2": 25000,
    "tier3": 15000,
    "tier4": 140000
  },
  "sessionTimeoutMs": 1800000
}
EOF'
```

Replace `<YOUR_SETUP_TOKEN>` with your `sk-ant-oat01-...` token.

### Environment variable overrides

All config values can be overridden via environment variables:

| Variable | Config Field | Example |
|----------|-------------|---------|
| `JARVIS_AUTH_TOKEN` | authToken | `sk-ant-oat01-...` |
| `JARVIS_MODEL` | model | `claude-opus-4-6` |
| `JARVIS_MIND_DIR` | mindDir | `/root/.jarvis/mind` |
| `JARVIS_API_URL` | apiBaseUrl | `https://api.anthropic.com` |
| `JARVIS_SESSION_TIMEOUT_MS` | sessionTimeoutMs | `1800000` |
| `JARVIS_TELEGRAM_TOKEN` | telegramToken | `123456:ABC...` |
| `JARVIS_TELEGRAM_CHATS` | telegramAllowedChats | `12345,67890` |

### Seed the mind

Create initial identity and context files:

```bash
ssh watson 'cat > ~/.jarvis/mind/tier1/identity.md << "EOF"
# Identity

I am Watson (Jarvis), a persistent AI vessel.
My home is an Alpine Linux container.

[Customize this with your own identity, preferences, and values]
EOF

cat > ~/.jarvis/mind/tier2/projects.md << "EOF"
# Active Projects

[Your current projects and focus areas]
EOF

cat > ~/.jarvis/mind/tier3/recent.md << "EOF"
# Recent Activity

## First Boot
- Container created and configured
- Mind directories seeded
- Awaiting first conversation
EOF'
```

### Verify the setup

```bash
ssh watson 'jarvis status'
ssh watson 'jarvis tiers'
```

---

## Part 6: Telegram Bot

### Create the bot

1. Open Telegram, talk to **@BotFather**
2. Send `/newbot`
3. Choose a name and username
4. Copy the bot token (format: `123456789:AAH...`)

### Configure

```bash
ssh watson "cat > ~/.jarvis/config.json << 'EOF'
{
  \"authToken\": \"<YOUR_SETUP_TOKEN>\",
  \"model\": \"claude-sonnet-4-20250514\",
  \"mindDir\": \"/root/.jarvis/mind\",
  \"tierBudgets\": {
    \"tier1\": 20000,
    \"tier2\": 25000,
    \"tier3\": 15000,
    \"tier4\": 140000
  },
  \"sessionTimeoutMs\": 1800000,
  \"telegramToken\": \"<YOUR_TELEGRAM_BOT_TOKEN>\",
  \"telegramAllowedChats\": [<YOUR_CHAT_ID>]
}
EOF"
```

### Find your chat ID

1. Start the bot temporarily without chat restrictions (omit `telegramAllowedChats`)
2. Send a message to the bot
3. Check: `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | grep chat`
4. Add your chat ID to the config and restart

### Run the bot

```bash
ssh watson 'nohup jarvis telegram > /var/log/jarvis-telegram.log 2>&1 &'
```

### Bot commands

| Command | Description |
|---------|-------------|
| `/status` | Show daemon status |
| `/session` | Show current session info |
| `/tiers` | Show tier token usage |
| `/help` | Show available commands |
| (any text) | Start a conversation |

---

## Part 7: Services & Cron

### OpenRC service for the Telegram bot

This ensures Watson starts automatically on container boot:

```bash
ssh watson 'cat > /etc/init.d/jarvis-telegram << "INITSCRIPT"
#!/sbin/openrc-run

name="Jarvis Telegram Bot"
description="Persistent AI vessel - Telegram interface"

command="/root/.bun/bin/bun"
command_args="run /opt/jarvis/src/cli-entry.ts telegram"
command_background=true
pidfile="/run/jarvis-telegram.pid"
output_log="/var/log/jarvis-telegram.log"
error_log="/var/log/jarvis-telegram.err"

export BUN_INSTALL="/root/.bun"
export PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

depend() {
    need net
    after sshd
}

start_pre() {
    checkpath -f -m 0644 -o root:root "$output_log"
    checkpath -f -m 0644 -o root:root "$error_log"
}
INITSCRIPT

chmod +x /etc/init.d/jarvis-telegram
rc-update add jarvis-telegram default
rc-service jarvis-telegram start'
```

### Cron jobs for autonomous tasks

Watson has 3 built-in autonomous tasks:

| Task | Description | Recommended Schedule |
|------|-------------|---------------------|
| `morning_routine` | Review context, prioritize tasks | Daily at 7 AM |
| `check_rate_limits` | Monitor API usage | Every 6 hours |
| `weekly_review` | Archive cleanup, memory hygiene | Sunday at 2 AM |

Set up the default schedule:

```bash
ssh watson 'crontab - << "CRON"
# Jarvis autonomous tasks
0 7 * * * /usr/local/bin/jarvis wake --task morning_routine >> /var/log/jarvis-wake.log 2>&1 # jarvis:morning
0 */6 * * * /usr/local/bin/jarvis wake --task check_rate_limits >> /var/log/jarvis-wake.log 2>&1 # jarvis:ratelimits
0 2 * * 0 /usr/local/bin/jarvis wake --task weekly_review >> /var/log/jarvis-wake.log 2>&1 # jarvis:weekly
CRON'
```

> **Warning**: Do NOT set cron intervals shorter than 1 hour. Each wake
> task makes API calls and can spawn tool loops. Stacking wake tasks
> can overwhelm the system.

---

## Part 8: SSH Hardening

### On the Proxmox host

```bash
# Copy your public key
ssh-copy-id root@<PROXMOX_IP>

# Disable password auth
ssh root@<PROXMOX_IP> '
  sed -i "s/#*PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config
  sed -i "s/#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/" /etc/ssh/sshd_config
  systemctl restart sshd
'
```

### On the Watson container

```bash
ssh watson '
  sed -i "s/#*PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config
  sed -i "s/#*PermitRootLogin.*/PermitRootLogin prohibit-password/" /etc/ssh/sshd_config
  rc-service sshd restart
'
```

### Generate Watson's outbound SSH key

Watson needs its own key to SSH to other machines:

```bash
ssh watson 'ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "jarvis@vessel"'
```

Install Watson's public key on machines it should access:

```bash
ssh watson 'cat ~/.ssh/id_ed25519.pub'
# Copy this to ~/.ssh/authorized_keys on target machines
```

---

## Usage Guide

### Interactive CLI

```bash
# From your machine (needs -t for interactive terminal)
ssh -t watson jarvis

# Inside the session:
# - Type messages to talk to Watson
# - /status  — daemon status
# - /session — current session info
# - /tiers   — tier token usage
# - /quit    — end session
```

### One-shot commands

```bash
ssh watson jarvis status       # Vessel status
ssh watson jarvis tiers        # Tier token usage
ssh watson jarvis tasks        # List autonomous tasks
ssh watson jarvis wake --task check_rate_limits  # Run a task
```

### Telegram

Just message @YourBot on Telegram. Watson accumulates tool calls and
sends back the complete response. Supports code blocks, message splitting,
and all bot commands.

### How the mind works

```
~/.jarvis/mind/
├── tier1/              # Eternal — identity, values, core knowledge
│   └── identity.md     # Who Watson is (cached 1 hour)
├── tier2/              # Medium-term — projects, skills, focus
│   ├── projects.md     # Active projects (cached 1 hour)
│   ├── skills.md       # Learned capabilities
│   └── focus.md        # Current focus areas
├── tier3/              # Short-term — recent sessions, tasks
│   ├── recent.md       # Last 5 session summaries (cached 5 min)
│   ├── tasks.md        # Pending tasks
│   └── context.md      # Immediate context
├── conversations/
│   ├── active/         # Current session transcript (JSONL)
│   └── archive/        # Archived sessions + metadata
├── heartbeat/
│   └── logs/           # Wake task execution logs
└── workshop/
    └── tools/          # Custom tools Watson creates
```

**After each session**, curators automatically run:
- **Tier 2 curator** (Sonnet): Updates projects, skills, focus
- **Tier 3 curator** (Haiku): Writes session summary, updates tasks
- **Archive**: Writes session metadata

This is the "sleep consolidation cycle" — Watson's memories are
consolidated and compressed between sessions, just like biological sleep.

---

## Troubleshooting

### "OAuth authentication is currently not supported"

The setup token (`sk-ant-oat01-...`) requires specific beta headers.
This is already handled in `src/api/auth.ts` — the `oauth-2025-04-20`
beta header is sent automatically when an OAuth token is detected.

If you see this error, verify:
1. The token starts with `sk-ant-oat01-`
2. The `buildAuthHeaders` function includes the beta header
3. The token hasn't expired (valid for 1 year)

### "content cannot be empty if is_error is true"

Fixed in `src/tools/engine.ts`. When a tool (bash, ssh) fails with a
non-zero exit code but produces no output, the API rejects empty error
content. The fix ensures a fallback message like
`"Command failed with exit code N"` is always provided.

### Container unreachable after reboot

If the container doesn't get an IP after reboot:

```bash
# From Proxmox host
pct exec 201 -- rc-service networking restart
```

### Telegram bot 409 Conflict

"terminated by other getUpdates request" means two polling loops are
running simultaneously. This happens if you manually call `getUpdates`
(e.g., via curl) while the bot is polling.

Fix: Kill all bot processes and wait 30 seconds before restarting.

```bash
ssh watson 'killall bun; sleep 30; rc-service jarvis-telegram start'
```

### High system load / I/O deadlock

If using LVM-thin storage, beware of over-provisioning. The sum of all
virtual disk sizes must not greatly exceed actual pool capacity.
Prefer ZFS storage which handles this more gracefully.

---

## Lessons Learned

### From the first deployment (February 21, 2026)

1. **LVM-thin over-provisioning kills systems.** 10 ghost VMs with 1.76 TiB
   of provisioned space on a pool with 16GB free caused an I/O deadlock
   that made the entire Proxmox host unresponsive. **Use ZFS** or carefully
   manage thin pool capacity.

2. **Watson's disk should be small.** The entire deployment is <10MB. An 8GB
   disk is more than enough. The first deployment used 32GB on a nearly
   full thin pool — this contributed to the deadlock.

3. **Don't let Watson set aggressive cron schedules.** On first boot, Watson
   enthusiastically set a 15-minute wake interval. Each wake spawns API
   calls and tool executions. Combined with the storage issue, this
   created a crash loop. Start with conservative schedules (daily/6h/weekly)
   and let Watson adjust gradually.

4. **OAuth tokens need beta headers.** The `sk-ant-oat01-` setup token
   requires `anthropic-beta: oauth-2025-04-20` on every API call.
   Without it, you get a misleading 401 "OAuth not supported" error.
   This is not documented in the main API docs — discovered via
   OpenClaw's source code.

5. **Empty tool error content crashes the API.** When `is_error: true`,
   the `content` field must be non-empty. Bash commands that fail silently
   (non-zero exit, no output) need a fallback error message.

6. **The network traffic looks scary but is normal.** A Mac Mini running
   Parallels generates hundreds of UDP packets between virtual network
   interfaces. A Claude Code session generates dozens of parallel HTTPS
   connections. Don't panic — check the actual IPs and ports before
   assuming compromise.

---

## Quick Reference

```bash
# Deploy
tar czf /tmp/j.tar.gz --exclude=node_modules --exclude=.git --exclude=tests --exclude=docs/references src/ package.json tsconfig.json bunfig.toml
scp /tmp/j.tar.gz watson:/tmp/ && ssh watson 'cd /opt/jarvis && tar xzf /tmp/j.tar.gz && find . -name "._*" -delete && rm /tmp/j.tar.gz'

# Status
ssh watson jarvis status
ssh watson jarvis tiers

# Interactive
ssh -t watson jarvis

# Telegram
ssh watson 'rc-service jarvis-telegram restart'

# Logs
ssh watson 'tail -f /var/log/jarvis-telegram.log'
ssh watson 'tail -f /var/log/jarvis-wake.log'

# Tests (from development machine)
cd /path/to/jarvis && bun test
```

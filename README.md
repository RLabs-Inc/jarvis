# Jarvis

A persistent AI vessel with tiered context engineering. Not a chatbot — an always-on entity with its own memory, schedule, and the ability to act autonomously between conversations.

```
620 tests | 34 source files | 7,128 lines | 1 runtime dependency
```

---

## What Is This?

Jarvis is an AI system that maintains persistent identity and memory across conversations. Instead of starting fresh every time, Jarvis remembers who it is, what it's working on, and what happened before — through a tiered memory system that maps to Claude's prompt caching architecture.

It runs as a native macOS process on a Mac Mini, accessible via Telegram or terminal. Between conversations, curator sub-agents process session transcripts to update memory files. Cron-triggered autonomous tasks let Jarvis act without being prompted.

## How It Works

### Tiered Context (The Core Innovation)

Every API call includes a system prompt assembled from four tiers, each with its own cache TTL:

| Tier | Content | Cache TTL | Updated By |
|------|---------|-----------|------------|
| **Tier 1** — Eternal | Identity, core values, personality | 1 hour | Human only |
| **Tier 2** — Projects | Skills, active projects, focus areas | 1 hour | Sonnet curator |
| **Tier 3** — Recent | Last sessions, tasks, immediate context | 5 minutes | Haiku curator |
| **Tier 4** — Live | Current conversation messages | Not cached | Conversation loop |

Cache breakpoints are placed between tiers using `cache_control` on system prompt blocks. Tiers 1-2 rarely change (1h cache), Tier 3 changes after each session (5m cache), Tier 4 is always fresh. Cache hits cost 10% of normal input token pricing — this means ~90% savings on the static portions of context that don't change between messages.

### Memory Files

Each tier is a directory of markdown files (`mind/tier1/`, `mind/tier2/`, `mind/tier3/`). Files are read alphabetically and concatenated into system prompt blocks at assembly time.

**Tier 1** (human-curated):
- `identity.md` — Who Jarvis is, core values, hard-won lessons

**Tier 2** (Sonnet-curated):
- `projects.md` — Active project states, milestones, blockers
- `skills.md` — Capability inventory with dates learned
- `focus.md` — Current priorities and direction

**Tier 3** (Haiku-curated):
- `recent.md` — Last 5 session summaries
- `tasks.md` — Active task list with dates
- `context.md` — Snapshot for next session pickup

### Post-Session Curation

When a session ends (user quits, idle timeout, or shutdown), three curators run in parallel:

1. **Tier 2 Curator** (Sonnet) — Reads the transcript, updates `projects.md`, `skills.md`, `focus.md`. Conservative: only updates what the evidence supports.
2. **Tier 3 Curator** (Haiku) — Updates `recent.md`, `tasks.md`, `context.md`. Keeps last 5 sessions, marks tasks complete, snapshots state.
3. **Archive Curator** — Moves the transcript from `conversations/active/` to `conversations/archive/` and writes a `.meta.json` sidecar with session metadata.

Curators receive the session transcript and current file contents, then return updated files wrapped in `<file name="...">` XML tags. Files are written atomically with `.bak` backups.

### Conversation Loop

The conversation engine handles multi-turn tool use:

```
message → context assembly → API call → response
  ↳ if tool_use → execute tools → feed results → API call → ...
  ↳ if max_tokens → auto-continue
  ↳ if end_turn → done
```

Features:
- **Streaming** — Text deltas yielded as `ConversationEvent`s for real-time display
- **Message queue injection** — Telegram messages sent while Jarvis is working are injected alongside tool results, so Claude sees them in context
- **Max turns safety** — Configurable limit (default 100) prevents runaway tool loops
- **Auto-continue** — When response is truncated by `max_tokens`, automatically prompts to continue
- **`pause_turn` handling** — Continues conversation when server-side tools hit iteration limits

### Heartbeat (Autonomous Tasks)

Three built-in cron tasks:

| Task | Schedule | Purpose |
|------|----------|---------|
| `morning_routine` | 7:00 AM daily | Review context, prioritize tasks |
| `check_rate_limits` | Every 6 hours | Monitor subscription utilization |
| `weekly_review` | 2:00 AM Sunday | Consolidate memories, clean archives |

Each task is a prompt template. The wake handler checks rate limits first — if utilization is above 80%, it defers the task. Between 50-80%, it downgrades the model (Opus → Sonnet → Haiku). Usage history is persisted for pattern awareness.

## Architecture

```
src/
├── api/
│   ├── auth.ts          OAuth token handling, usage checking
│   ├── client.ts         Raw fetch client (streaming + non-streaming)
│   ├── streaming.ts      SSE parser + stream accumulator
│   └── types.ts          Full Claude API type definitions
├── context/
│   ├── assembler.ts      THE CORE — tier reading, budget validation, cache breakpoints
│   ├── tiers.ts          Tier file I/O (read/write/validate)
│   ├── tokens.ts         Token estimation (~4 chars/token heuristic)
│   └── types.ts          Context system types
├── curators/
│   ├── orchestrator.ts   Parallel curator coordination
│   ├── tier2.ts          Sonnet curator (projects, skills, focus)
│   ├── tier3.ts          Haiku curator (recent, tasks, context)
│   ├── archive.ts        Transcript archival + metadata
│   ├── prompts.ts        Curator prompt templates + response parsing
│   └── helpers.ts        Shared utilities (file reading, text extraction)
├── heartbeat/
│   ├── cron.ts           Crontab schedule management
│   ├── rate-limits.ts    Utilization tracking + model selection
│   ├── tasks.ts          Built-in task definitions
│   └── wake.ts           One-shot task execution pipeline
├── senses/
│   ├── cli.ts            Interactive terminal (readline, slash commands)
│   ├── telegram.ts       Telegram bot (long polling, message queue, access control)
│   └── telegram-stream.ts  Streaming display (HTML formatting, tool indicators)
├── session/
│   ├── manager.ts        Session lifecycle (start, end, idle timeout)
│   └── transcript.ts     JSONL transcript storage (append-only, crash-safe)
├── tools/
│   ├── definitions.ts    Tool schemas (sent with every API call)
│   ├── engine.ts         Tool routing + execution
│   ├── bash.ts           Shell execution (non-interactive + PTY via `script`)
│   ├── files.ts          File read/write with auto-mkdir
│   ├── ssh.ts            Remote execution via native ssh binary
│   └── cron.ts           Crontab entry management (tagged with `# jarvis:`)
├── config.ts             Config loading (file + env vars + defaults)
├── conversation.ts       Multi-turn conversation loop with tool use
├── daemon.ts             Core daemon (lifecycle, message handling, curation)
├── mind.ts               Mind directory validation + creation
└── cli-entry.ts          Single entry point for all CLI commands
```

## Tools

Six built-in tools, all using system utilities (no npm dependencies):

| Tool | Implementation | What It Does |
|------|---------------|--------------|
| `bash` | `Bun.spawn` / `script` PTY | Shell commands. Interactive mode allocates a real PTY via the system `script` command — enabling Claude Code, vim, ssh sessions, or any TUI. |
| `read_file` | `fs.readFile` | Read files with optional line offset/limit for large files. |
| `write_file` | `fs.writeFile` | Write files, auto-creating parent directories. |
| `ssh_exec` | Native `ssh` binary | Remote command execution. `BatchMode=yes` (no password hangs), `StrictHostKeyChecking=accept-new`, shell-quoted parameters. |
| `web_fetch` | `fetch()` | HTTP GET/POST with custom headers, body, timeout. |
| `cron_manage` | Native `crontab` | List/add/remove cron entries tagged with `# jarvis:<id>` for safe identification. |

All tool outputs are truncated at 50K characters (head + tail with omission notice). Tool execution never throws — errors become `is_error: true` results.

## Senses (Input Interfaces)

### CLI (`jarvis`)

Interactive readline terminal with streaming output. Slash commands:

| Command | Action |
|---------|--------|
| `/quit` | End session, trigger curators, exit |
| `/status` | Daemon status (uptime, session, messages) |
| `/session` | Current session details |
| `/tiers` | Tier token usage with progress bars |
| `/help` | Show commands |

### Telegram (`jarvis telegram`)

Long-polling bot with:

- **Access control** — Configurable allowed chat IDs (empty = open mode)
- **Message queue** — Send messages while Jarvis is processing; they're injected inline with tool results
- **Streaming display** — One Telegram message per content unit (text, tool, thinking), edited progressively
- **Markdown → HTML** — Bold, italic, strikethrough, code blocks, blockquotes, links, lists, headings converted to Telegram HTML
- **Tool indicators** — Rich formatted tool status: `🔧 ls -la ⏳` → `🔧 ls -la → ✓ (3 lines)`
- **Auto-reconnect** — Exponential backoff on polling errors (5s → 60s max)

Bot commands: `/status`, `/session`, `/tiers`, `/help`

## Dependencies

| Package | Purpose | Used In |
|---------|---------|---------|
| `eventsource-parser` | SSE stream parsing | `src/api/streaming.ts` |

That's the one runtime dependency. Everything else is Bun built-ins (`fetch`, `spawn`, `fs`, `crypto`, `readline`).

> Note: `@anthropic-ai/sdk` is in `package.json` but not yet used in source code. The API client uses raw `fetch()` for full control over cache breakpoint placement. SDK migration is planned to enable extended thinking.

## Quick Start

```bash
# Prerequisites: Bun 1.3+ (https://bun.sh)
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone git@github.com:RLabs-Inc/jarvis.git
cd jarvis
bun install

# Run tests
bun test

# Type check
bun run check
```

## Configuration

Config priority: **Environment variables** > **~/.jarvis/config.json** > **built-in defaults**

### Config file

```bash
mkdir -p ~/.jarvis
cat > ~/.jarvis/config.json << 'EOF'
{
  "authToken": "sk-ant-oat01-your-token-here",
  "model": "claude-opus-4-6",
  "curationModel": "claude-haiku-4-5-20251001",
  "mindDir": "/opt/jarvis/mind",
  "tierBudgets": {
    "tier1": 20000,
    "tier2": 25000,
    "tier3": 15000,
    "tier4": 140000
  },
  "telegramToken": "123456:ABC-DEF...",
  "telegramAllowedChats": [12345678]
}
EOF
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JARVIS_AUTH_TOKEN` | *(required)* | Anthropic OAuth token (`claude setup-token`) |
| `JARVIS_MODEL` | `claude-opus-4-6` | Primary model |
| `JARVIS_CURATION_MODEL` | `claude-haiku-4-5-20251001` | Curator model |
| `JARVIS_MIND_DIR` | `~/mind` | Mind directory path |
| `JARVIS_API_URL` | `https://api.anthropic.com` | API endpoint |
| `JARVIS_SESSION_TIMEOUT_MS` | `1800000` | Session idle timeout (30 min) |
| `JARVIS_REQUEST_TIMEOUT_MS` | `30000` | HTTP request timeout |
| `JARVIS_TELEGRAM_TOKEN` | *(empty)* | Telegram bot token |
| `JARVIS_TELEGRAM_CHATS` | *(empty)* | Comma-separated allowed chat IDs |

### Getting a token

The auth token comes from an Anthropic Max subscription:
```bash
claude setup-token
# Copy the sk-ant-oat01-... token
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

## Deployment (macOS)

Target: Mac Mini M1 running natively — no containers.

### 1. Deploy the code

```bash
sudo mkdir -p /opt/jarvis
sudo chown $(whoami) /opt/jarvis
git clone git@github.com:RLabs-Inc/jarvis.git /opt/jarvis
cd /opt/jarvis
bun install
bun test  # Verify everything passes
```

### 2. Set up the mind directory

```bash
cd /opt/jarvis
mkdir -p mind/{tier1,tier2,tier3}
mkdir -p mind/conversations/{active,archive}
mkdir -p mind/heartbeat/logs
```

Seed the identity file:
```bash
cat > mind/tier1/identity.md << 'EOF'
# Identity

I am Jarvis, a persistent AI vessel.
[Customize your vessel's identity here]
EOF
```

### 3. Install Telegram bot as launchd service

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
launchctl load ~/Library/LaunchAgents/com.jarvis.telegram.plist
launchctl list | grep jarvis  # Verify
```

### 4. Deploy updates

```bash
cd /opt/jarvis
./scripts/deploy.sh
# Runs: git pull → bun install → bun test (gate) → service restart
```

The deploy script aborts if tests fail — the service keeps running on the previous version.

### 5. Monitoring

```bash
tail -f /opt/jarvis/logs/telegram.log    # Bot output
tail -f /opt/jarvis/logs/telegram.err    # Errors
launchctl list | grep jarvis              # Service status
ls /opt/jarvis/mind/heartbeat/logs/       # Wake task logs
```

## Testing

```bash
bun test                          # All 620 tests
bun test tests/api/               # API layer
bun test tests/context/           # Context assembly
bun test tests/curators/          # Curation system
bun test tests/tools/             # Tool execution
bun test tests/senses/            # CLI + Telegram
bun test tests/heartbeat/         # Autonomous tasks
bun test tests/session/           # Session management
```

Tests mock all external services. No API keys needed.

## Design Decisions

**Raw `fetch()` instead of SDK** — The tiered context system requires precise control over `cache_control` placement on system prompt blocks with mixed TTLs (1h + 5m). The official SDK didn't support this when Jarvis was built. Migration is planned.

**`script` command for PTY** — Instead of `node-pty` or FFI bindings, PTY allocation uses the system `script` command (`script -q /dev/null bash -c "cmd"` on macOS). Zero dependencies, works everywhere.

**JSONL transcripts** — Append-only format means crash-safe writes (no need to rewrite the whole file). Each line is a self-contained JSON object with timestamp and message.

**Character-based token estimation** — Uses ~4 chars/token heuristic instead of the real tokenizer. Slightly overestimates (safe for budgets), avoids a heavy dependency. The API returns exact counts for billing.

**Atomic file writes with backup** — Curator outputs go through `write → .tmp`, `copy → .bak`, `rename .tmp → target`. If any step fails, previous state is preserved.

## Project History

Built in a single day (February 21, 2026) across 9 sessions:

| Session | Layer | Tests |
|---------|-------|-------|
| A | Project foundation & config | 32 |
| B | Claude API client with cache control | 43 |
| C | Tiered context system | 38 |
| D | PTY bash & tool engine | 65 |
| E | Daemon core & session management | 65 |
| F | Post-interaction curators | 55 |
| G | Heartbeat & self-scheduling | 60 |
| H | CLI interface & polish | 51 |
| I | Telegram integration | 57 |

Detailed spec: `docs/JARVIS_SPEC.md` | Build progress: `docs/JARVIS_PROGRESS.md`

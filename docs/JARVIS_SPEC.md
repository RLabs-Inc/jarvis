# Jarvis - Frozen Architecture Specification

> **Version**: 1.0
> **Created**: Session 0 (February 21, 2026)
> **Status**: FROZEN — Approved by Sherlock on February 21, 2026. This spec is immutable.

## Overview

Jarvis is a persistent AI vessel — a self-organizing, always-on personal agent that lives in its own container, maintains continuous consciousness through tiered context engineering, and can act autonomously between interactions. Unlike chatbots that wake and forget, Jarvis never starts from zero. Unlike agent frameworks that bolt memory onto chat, Jarvis's memory IS its mind — assembled into the context window before every API call.

The core innovation is **tiered context engineering**: instead of treating the context window as a conversation buffer with memory sprinkled in, Jarvis treats the context window as a **persistent mind** — always pre-loaded with curated knowledge, with the live conversation occupying only the tail. Post-interaction curator agents update the tiers, creating a sleep-consolidation cycle that mirrors biological memory.

## Philosophy

- **The vessel, not the tool.** Jarvis isn't software you install. It's an entity that has its own computer, its own filesystem, its own schedule. The container is its home.
- **Freedom over orchestration.** Don't pre-build what the AI can build for itself. Provide the primitives (shell, internet, package manager) and let the complexity emerge.
- **Minimal infrastructure, maximal capability.** An Alpine Linux container, a daemon, a crontab, and freedom. Everything else, Jarvis builds as needed.
- **The Dante Principle.** Learning through immersion and self-organization, not through rigid instruction. The tier structure emerged organically from months of curation before we named it.
- **Tools, not frameworks.** Claude Code, the Claude API, bash, SSH — these are all tools in the workshop, not the workshop itself. The daemon uses the right tool for the right job. No single tool is the center. The vessel is the center.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       THE VESSEL                              │
│                (Alpine Linux LXC on Proxmox)                  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                    THE MIND                             │   │
│  │              (Tiered Context System)                    │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐ │   │
│  │  │ Tier 1  │ │ Tier 2  │ │ Tier 3  │ │   Tier 4    │ │   │
│  │  │ Static  │ │ Medium  │ │ Short   │ │ Conversation│ │   │
│  │  │ (1h TTL)│ │ (1h TTL)│ │ (5m TTL)│ │  (no TTL)   │ │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘ │   │
│  └───────────────────────┬────────────────────────────────┘   │
│                          │                                     │
│  ┌───────────────┐  ┌────┴────┐  ┌─────────────────────────┐ │
│  │   Heartbeat   │  │ Daemon  │  │       Curators          │ │
│  │   (crontab)   │──│  (Bun)  │──│  (post-interaction)     │ │
│  └───────────────┘  └────┬────┘  └─────────────────────────┘ │
│                          │                                     │
│  ┌───────────────────────┴───────────────────────────────┐   │
│  │                   THE HANDS                            │   │
│  │                                                        │   │
│  │  ┌──────────┐ ┌────────────┐ ┌──────┐ ┌────────────┐ │   │
│  │  │ Direct   │ │Claude Code │ │ PTY  │ │    SSH     │ │   │
│  │  │ API      │ │(agents,    │ │ Bash │ │  (network  │ │   │
│  │  │(cache    │ │ teams,     │ │(any  │ │   machines)│ │   │
│  │  │ control) │ │ coding)    │ │ CLI) │ │            │ │   │
│  │  └──────────┘ └────────────┘ └──────┘ └────────────┘ │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                   THE SENSES                           │   │
│  │  CLI  │  Telegram  │  Webhooks  │  Cron (autonomous)  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                  THE WORKSHOP                          │   │
│  │  ~/workshop/tools/     — Quick scripts & utilities     │   │
│  │  ~/workshop/projects/  — Full projects built by Jarvis │   │
│  │  (Built using Claude Code interactive sessions)        │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Component 1: The Tiered Context System

The core innovation. The context window is treated as a persistent mind, not a conversation buffer.

### Tier Structure

| Tier | Name | Content | Cache TTL | Token Budget | Update Frequency |
|------|------|---------|-----------|-------------|-----------------|
| 1 | Long-term Static | Identity, personality, core knowledge, stable preferences, tool definitions | 1 hour | ~20K tokens | Rarely (manual or major events) |
| 2 | Medium-term Curated | Active projects, current focus areas, ongoing relationships, skill inventory | 1 hour | ~25K tokens | After each interaction session |
| 3 | Short-term Curated | Recent session summaries, current tasks, immediate context, today's work | 5 minutes | ~15K tokens | After each interaction session |
| 4 | Current Interaction | Live conversation messages, tool call/result history | None | ~140K tokens | Real-time (every message) |

**Total budget**: ~200K tokens (standard context window).
With 1M context (Tier 4+ beta), Tier 4 expands to ~940K tokens.

### Tier File Format

Each tier is stored as one or more markdown files in the vessel's filesystem:

```
~/mind/
├── tier1/
│   ├── identity.md          # Who I am, personality, values
│   ├── sherlock.md           # Everything about Rusty/Sherlock
│   ├── relationships.md     # Family, collaborators
│   ├── preferences.md       # Stable workflow preferences
│   └── tools.md             # Tool definitions for API
├── tier2/
│   ├── projects.md          # Active project states
│   ├── skills.md            # Current skill inventory
│   └── focus.md             # Current focus areas
├── tier3/
│   ├── recent.md            # Last 3-5 session summaries
│   ├── tasks.md             # Active tasks and todos
│   └── context.md           # Immediate context
├── conversations/
│   ├── active/              # Current session transcript
│   └── archive/             # Past session transcripts
└── workshop/
    └── tools/               # Self-built tools
```

### Context Assembly

Before each API call, the Context Assembler:

1. Reads all files in `tier1/`, concatenates to a single text block
2. Reads all files in `tier2/`, concatenates
3. Reads all files in `tier3/`, concatenates
4. Reads current session messages from `conversations/active/`
5. Validates total tokens against budget (truncates Tier 4 if needed, never Tier 1-3)
6. Assembles the API request with cache breakpoints between tiers

### API Request Structure

```typescript
{
  model: "claude-opus-4-6",
  max_tokens: 16384,
  system: [
    // Tier 1: Long-term static
    { type: "text", text: tier1Content },
    { type: "text", text: tier1Tools, cache_control: { type: "ephemeral", ttl: "1h" } },
    // Tier 2: Medium-term curated
    { type: "text", text: tier2Content, cache_control: { type: "ephemeral", ttl: "1h" } },
    // Tier 3: Short-term curated
    { type: "text", text: tier3Content, cache_control: { type: "ephemeral", ttl: "5m" } },
  ],
  tools: [...toolDefinitions],  // Cached with system prompt
  messages: [
    // Tier 4: Current interaction (no caching)
    ...sessionMessages
  ]
}
```

### Token Counting

Use `@anthropic-ai/tokenizer` or tiktoken for pre-assembly token counting.
Each tier enforces a hard budget. If a tier exceeds its budget, the Context Assembler:
- For Tier 1: Error — must be manually trimmed (this is core identity)
- For Tier 2: Curators must compress (flag for next curation cycle)
- For Tier 3: Oldest entries dropped first
- For Tier 4: Oldest messages summarized and collapsed

## Component 2: The Daemon

The always-on process that is the vessel's heartbeat.

### Responsibilities

1. **Listen** for incoming messages (from CLI, Telegram, webhooks)
2. **Assemble** the tiered context before each API call
3. **Call** the Claude API with proper caching
4. **Execute** tool calls and feed results back
5. **Manage** the conversation loop (multi-turn with tools)
6. **Trigger** post-interaction curation when a session ends
7. **Track** rate limits and manage model selection

### Technology

- **Runtime**: Bun (TypeScript, no compile step — critical for self-extension)
- **HTTP**: Native fetch API for Claude API calls
- **Process management**: `child_process` for tool execution and sub-agents
- **File system**: Node fs/promises for tier file management
- **IPC**: Unix domain sockets for local message passing

### Multi-Turn Conversation Loop

```
User Message
    ↓
Context Assembly (Tier 1-3 from files + Tier 4 from session)
    ↓
Claude API Call (streaming)
    ↓
┌─ Response Type? ─────────────────┐
│                                   │
│  Text → Display to user           │
│         Add to session history     │
│         Wait for next message      │
│                                   │
│  Tool Use → Execute tool           │
│             Add result to history  │
│             Loop back to API call  │
│                                   │
│  End Turn → Check if session ends  │
│             If yes → trigger curators │
└───────────────────────────────────┘
```

### Session Management

- Each interaction with the user is a **session**
- Sessions have a unique ID, start time, and status (active/ended)
- The active session transcript is stored in `conversations/active/`
- When a session ends, the transcript moves to `conversations/archive/`
- A session ends when:
  - The user explicitly says goodbye/done
  - Idle timeout (configurable, default 30 minutes)
  - The user starts a new topic (implicit new session)

## Component 3: The Curators

Post-interaction sub-agents that update the memory tiers. This is the "sleep consolidation" cycle.

### Curator Types

**Tier 2 Curator** (Medium-term):
- Reads the session transcript
- Updates `tier2/projects.md` with any project state changes
- Updates `tier2/skills.md` with new capabilities demonstrated
- Updates `tier2/focus.md` with current focus areas
- Uses Sonnet or Haiku for cost efficiency

**Tier 3 Curator** (Short-term):
- Reads the session transcript
- Writes a session summary to `tier3/recent.md` (keeps last 3-5)
- Updates `tier3/tasks.md` with new/completed tasks
- Updates `tier3/context.md` with immediate context
- Drops oldest entries if over budget
- Uses Haiku for speed and cost

**Archive Curator**:
- Moves session transcript to `conversations/archive/`
- Extracts key memories for long-term storage
- Optionally indexes transcript for future search

### Curation Trigger

After each interaction session ends:
1. Daemon fires curation event
2. Tier 3 Curator runs first (fast, Haiku)
3. Tier 2 Curator runs second (medium, Sonnet)
4. Archive Curator runs last (background)
5. All curators can run in parallel if independent

### Curation Safety

- Curators NEVER modify Tier 1 (only Jarvis or Sherlock manually)
- Curators write to temp files first, then atomic rename
- Previous tier state is backed up before overwrite
- If curation fails, previous state is preserved

## Component 4: The Tool Engine

How Jarvis acts on the world. The daemon uses the right tool for the right job:

- **Direct API calls** — For core conversation, background tasks, curation (full control, cached context)
- **Claude Code** — When its built-in tools are useful (file editing, grep/glob, sub-agent Task tool, teams). Just another CLI tool: `claude -p "do this thing"`. Authenticated with Max subscription via setup-token.
- **Bun shell** — For system operations, PTY-capable interactive commands, custom scripts
- **SSH** — For remote machine access (Mac Mini, laptop, any network machine)
- **Self-built tools** — Scripts and utilities Jarvis creates in the workshop as needed

Claude Code is powerful but it's not the operating system. It's a wrench in the toolbox. The daemon decides when to use it vs when to call the API directly vs when to just run a shell command.

### Built-in Tools (for direct API mode)

```typescript
// Core tools available from day one
const CORE_TOOLS = [
  {
    name: "bash",
    description: "Execute a shell command in the vessel",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "number" },
        working_dir: { type: "string" }
      },
      required: ["command"]
    }
  },
  {
    name: "read_file",
    description: "Read a file from the vessel filesystem",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "ssh_exec",
    description: "Execute a command on a remote machine via SSH",
    input_schema: {
      type: "object",
      properties: {
        host: { type: "string" },
        command: { type: "string" },
        timeout_ms: { type: "number" }
      },
      required: ["host", "command"]
    }
  },
  {
    name: "cron_manage",
    description: "View, add, or remove crontab entries",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "remove"] },
        schedule: { type: "string" },
        command: { type: "string" },
        id: { type: "string" }
      },
      required: ["action"]
    }
  },
  {
    name: "spawn_agent",
    description: "Spawn a sub-agent for parallel work",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string" },
        model: { type: "string", enum: ["opus", "sonnet", "haiku"] },
        context: { type: "string" }
      },
      required: ["task"]
    }
  },
  {
    name: "web_fetch",
    description: "Fetch content from a URL",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST"] },
        headers: { type: "object" },
        body: { type: "string" }
      },
      required: ["url"]
    }
  }
]
```

### PTY Bash — The Foundational Capability

The PTY bash tool is not a feature — it is the **single most important capability** of the vessel. With a proper pseudo-terminal, Jarvis can use ANY tool built for humans. There is no human at the keyboard. There is Jarvis.

**What PTY enables:**

- **Claude Code interactive sessions** — Jarvis opens Claude Code in a project folder, has multi-turn conversations, guides it through complex tasks, course-corrects. Jarvis becomes the developer using an AI assistant. Recursive: AI using AI tools.
- **Interactive CLI tools** — Package managers (`npm init`, `apt install`), confirmation prompts, input wizards. Jarvis answers the prompts.
- **TUI applications** — `htop`, `vim`, `less`, any curses-based tool. Full terminal emulation.
- **Command-line browsers** — `lynx`, `w3m`, `links` for web browsing focused on content, no rendering overhead.
- **tmux sessions** — Multiple persistent terminal sessions within the vessel.
- **Any CLI ever built** — If it runs in a terminal, Jarvis can use it.
- **And if no CLI exists** — Jarvis opens a Claude Code session in `~/workshop/new-project/` and builds one.

**Implementation**: Bun's `Bun.spawn` with PTY allocation for interactive commands. Plain `child_process` for simple non-interactive commands. ANSI output captured and processed for tool results. The `bash` tool schema includes an optional `interactive: boolean` flag to select PTY mode.

### Self-Extension — The Developer Pattern

Jarvis doesn't wait for plugins. Jarvis IS the developer.

1. **Need a tool?** Write a script to `~/workshop/tools/`, or build a full project in `~/workshop/projects/`
2. **Need a complex tool?** Open a Claude Code session in the project folder: `cd ~/workshop/my-tool && claude`. Let Claude Code help build it — the same way Sherlock builds with Claude Code.
3. **Register it** in the tool definitions or just call it from bash
4. **Iterate** — open another Claude Code session to improve it

The workshop grows over time. Session 1: basic tools. Session 50: a full ecosystem of purpose-built utilities, each crafted for specific needs. The vessel builds itself.

No plugin framework. No marketplace. No dependencies on external ecosystems. Just a developer with a computer, building what they need.

## Component 5: The Heartbeat (Self-Scheduling)

### Crontab Integration

Jarvis manages its own crontab via the `cron_manage` tool:

```crontab
# Jarvis self-scheduled tasks
# Format: standard cron + task description

# Morning routine - check GitHub, prepare context
0 7 * * * /home/jarvis/daemon wake --task morning_routine

# Rate limit check - monitor Max subscription usage
0 */6 * * * /home/jarvis/daemon wake --task check_rate_limits

# Weekly review - consolidate memories, clean archive
0 2 * * 0 /home/jarvis/daemon wake --task weekly_review
```

### Wake Mechanism

When a cron job fires:
1. Cron executes the daemon's `wake` command
2. Daemon assembles context (Tier 1-3) with a system message describing the task
3. Claude API call processes the autonomous task
4. Results logged, tier files updated if needed
5. Daemon returns to idle

### Rate Limit Awareness

- Jarvis tracks Max subscription usage via `/api/oauth/usage`
- Before each API call, checks current utilization
- If approaching limits:
  - Defer non-urgent cron tasks
  - Use Haiku instead of Opus for background work
  - Log a warning for Sherlock
  - Never exceed limits — sleep and retry later

## Component 6: Agents & Teams (Claude Code)

Jarvis doesn't build agent orchestration. Jarvis uses Claude Code.

### How Agents Work

When Jarvis needs parallel work, sub-agents, or teams — it opens Claude Code:

```bash
# One-shot task
claude -p "Research the latest Bun PTY API changes" --output-format json

# Interactive session for complex work
cd ~/workshop/new-tool && claude
# (Jarvis interacts via PTY — multi-turn, guided, like a developer)

# Background task
claude -p "Review the n-nvim test suite for flaky tests" &
```

Claude Code already provides:
- **Task tool** — Spawn specialized sub-agents (Explore, Plan, Bash, etc.)
- **TeamCreate** — Coordinate multiple agents working in parallel
- **SendMessage** — Inter-agent communication
- **TaskCreate/Update/List** — Shared task tracking across agents
- **Background agents** — Run agents asynchronously

All authenticated with the same Max subscription. No additional cost.

### When to Use Claude Code vs Direct API

| Scenario | Tool | Why |
|----------|------|-----|
| Core conversation with Sherlock | Direct API | Cache control, tiered context |
| Post-interaction curation | Direct API | Lightweight, specific prompt |
| Code exploration/editing | Claude Code | Built-in Read/Write/Edit/Grep |
| Multi-agent parallel research | Claude Code | Task tool, teams |
| Building a new tool | Claude Code interactive | Full development environment |
| Quick system task | PTY Bash | Just a shell command |
| Checking a website | PTY Bash + lynx | Content-focused browsing |
| Remote machine work | SSH | Direct access |

## Component 7: The Senses (Input/Output)

### Phase 1: CLI Interface

The first interface. Simple stdin/stdout:

```bash
$ jarvis
🤖 Jarvis is ready. Context loaded (Tier 1: 18K, Tier 2: 22K, Tier 3: 12K)

You: Hey Watson, what were we working on last?
Jarvis: Based on my context, we were...

You: /quit
🤖 Session ended. Curators running...
```

### Phase 2: Telegram Bot

The primary remote interface:

- Telegram bot token stored in vessel config
- Messages routed through the daemon
- Supports text, images, files
- Commands: `/status`, `/think`, `/forget`, `/session`
- Group support possible (but 1:1 is primary)

### Phase 3: Webhooks

For autonomous triggers:
- GitHub webhook listener (push events, issue comments)
- Custom webhook endpoints for integrations
- Each webhook can trigger a session or add context

## Component 8: Authentication

### Setup-Token Auth

Jarvis authenticates with the Claude API using a setup-token from the Max subscription:

```typescript
// Token generated via: claude setup-token
// Format: sk-ant-oat01-...

const AUTH_CONFIG = {
  provider: "anthropic",
  type: "token",
  token: process.env.JARVIS_AUTH_TOKEN || readFromCredentials(),
};

// API calls use Bearer auth:
headers: {
  "Authorization": `Bearer ${AUTH_CONFIG.token}`,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "prompt-caching-2024-07-31"
}
```

### Rate Limit Tracking

```typescript
// Check subscription usage before API calls
async function checkUsage(): Promise<UsageInfo> {
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { "Authorization": `Bearer ${AUTH_CONFIG.token}` }
  });
  return response.json();
  // Returns: { five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at } }
}
```

## Project Structure

```
jarvis/
├── docs/
│   ├── JARVIS_SPEC.md              # This file (frozen)
│   ├── JARVIS_PROGRESS.md          # Live tracker
│   └── references/
│       └── openclaw/               # Reference codebase
├── scripts/
│   └── run_sessions.sh             # Session automation
├── src/
│   ├── daemon.ts                   # Main daemon entry point
│   ├── config.ts                   # Configuration loading
│   ├── context/
│   │   ├── assembler.ts            # Tiered context assembly
│   │   ├── tiers.ts                # Tier reading and validation
│   │   └── tokens.ts               # Token counting utilities
│   ├── api/
│   │   ├── client.ts               # Claude API client
│   │   ├── streaming.ts            # SSE streaming handler
│   │   └── auth.ts                 # Setup-token authentication
│   ├── tools/
│   │   ├── engine.ts               # Tool execution engine
│   │   ├── definitions.ts          # Core tool definitions
│   │   ├── bash.ts                 # Shell execution (PTY-capable)
│   │   ├── files.ts                # File operations
│   │   ├── ssh.ts                  # Remote execution
│   │   └── cron.ts                 # Crontab management
│   ├── curators/
│   │   ├── orchestrator.ts         # Curation trigger and coordination
│   │   ├── tier2.ts                # Medium-term curator
│   │   ├── tier3.ts                # Short-term curator
│   │   └── archive.ts              # Transcript archival
│   ├── agents/
│   │   ├── spawner.ts              # Sub-agent spawning
│   │   └── models.ts               # Model selection logic
│   ├── heartbeat/
│   │   ├── cron.ts                 # Crontab self-management
│   │   ├── wake.ts                 # Wake from cron handler
│   │   └── rate-limits.ts          # Usage tracking
│   ├── senses/
│   │   ├── cli.ts                  # CLI interface
│   │   ├── telegram.ts             # Telegram bot (Phase 2)
│   │   └── webhooks.ts             # Webhook listener (Phase 3)
│   └── session/
│       ├── manager.ts              # Session lifecycle
│       └── transcript.ts           # Transcript storage
├── tests/
│   ├── context/
│   ├── api/
│   ├── tools/
│   ├── curators/
│   ├── agents/
│   ├── heartbeat/
│   └── session/
├── mind/                           # Created at deployment in the vessel
│   ├── tier1/
│   ├── tier2/
│   ├── tier3/
│   ├── conversations/
│   └── workshop/
├── package.json
├── tsconfig.json
├── bunfig.toml
└── Dockerfile                      # For vessel deployment
```

## Dependencies

Minimal, per our philosophy:

### Vessel Software (installed in the container)

| Software | Purpose | Notes |
|----------|---------|-------|
| Bun | TypeScript runtime for daemon | No compile step, native fetch, fast |
| Claude Code | Available as a tool when needed | Authenticated with Max setup-token |
| Git | Version control, project access | Standard |
| SSH | Remote machine access | With keys to network machines |
| Tailscale | Network connectivity | Persistent .ts.net access |

### NPM Dependencies

| Dependency | Purpose | Justification |
|-----------|---------|---------------|
| `@anthropic-ai/sdk` | Claude API client | Official SDK, handles streaming/auth |
| `eventsource-parser` | SSE stream parsing | Standard, tiny, needed for streaming |

**That's it.** Two production dependencies. Everything else is Bun standard library or self-built.

If we don't want the official SDK, we can use raw `fetch` + `eventsource-parser` (1 dep).
Token counting uses a local approximation (chars/4) or the official tokenizer as optional addition.

## What This Spec Does NOT Cover

- **Voice interface** — Future enhancement, not MVP
- **Mobile app** — Messaging channels (Telegram) serve this role
- **Multi-user support** — Jarvis is personal, for Sherlock
- **Web UI** — CLI and messaging are the interfaces
- **End-to-end encryption** — Trust model is local vessel + Tailscale
- **Specific tier content** — What goes IN the tiers is Jarvis's decision, not the spec's
- **Deployment automation** — Vessel setup is manual for now (Proxmox + Alpine)

## Key Design Decisions

1. **TypeScript/Bun over Rust/Swift** — Self-extension requires no compile step. Jarvis must be able to modify its own daemon code.
2. **Setup-token over API key** — Leverages Max subscription. Zero marginal cost.
3. **LXC over VM** — 65% less resources, 2-second boot, near-native performance.
4. **Files over database** — Tier content is markdown files. Human-readable, version-controllable, easy for Jarvis to edit. No SQLite, no embeddings (can be added later as a self-built tool).
5. **4 tiers matching 4 cache breakpoints** — The API was designed for this pattern.
6. **Curators as sub-agents, not inline** — Curation shouldn't block the conversation. Fire-and-forget after session ends.
7. **CLI first, Telegram second** — Get the core working before adding channels.
8. **Claude Code as a tool, not the runtime** — The daemon calls the API directly for core interactions (full control over caching, context assembly). Claude Code is available in the vessel as a power tool — used when its specific capabilities (file editing, code search, sub-agent teams) are the right fit. The daemon decides which tool to use.

## Interaction with Existing Systems

- **memory-ts hooks** — Our existing hook system (session-start, user-prompt, curation) is the prototype. Jarvis internalizes this logic into the daemon.
- **CLAUDE.md personal primer** — The current primer content becomes the seed for Tier 1 and Tier 2.
- **Memory API (localhost:8765)** — Not needed in Jarvis. The daemon IS the memory system.

---

*This spec becomes immutable once approved by Sherlock.*

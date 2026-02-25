# Jarvis - Live Progress Tracker

> **Spec**: [JARVIS_SPEC.md](./JARVIS_SPEC.md)
> **Started**: February 21, 2026
> **Language**: TypeScript / Bun
> **Philosophy**: One brick at a time. The vessel builds itself.

## Status Overview

| Session | Title | Status | Tests Added | Running Total |
|---------|-------|--------|-------------|---------------|
| 0 | Planning & Reconnaissance | COMPLETE | 0 | 0 |
| A | Project Foundation & Config | COMPLETE | 47 | 47 |
| B | Claude API Client | REVIEWED | 54 | 101 |
| C | Tiered Context System | REVIEWED | 40 | 141 |
| D | PTY Bash & Tool Engine | REVIEWED | 80 | 221 |
| E | Daemon Core & Session Management | REVIEWED | 71 | 292 |
| F | Post-Interaction Curators | REVIEWED | 69 | 361 |
| G | Heartbeat & Self-Scheduling | COMPLETE | 60 | 421 |
| H | CLI Interface & Polish | COMPLETE | 51 | 472 |
| I | Messaging Integration (Telegram) | COMPLETE | 57 | 529 |

---

## Session 0: Planning & Reconnaissance

**Goal**: Design the architecture and create the frozen spec.

**Status**: COMPLETE

**Summary**: Full reconnaissance deployed — 4 parallel agents explored Claude API (prompt caching, 4 breakpoints, setup-token auth), Proxmox infrastructure (Alpine LXC, 512MB RAM, Tailscale), existing memory-ts hooks (proto-Jarvis), and OpenClaw's subscription handling. Architecture designed: tiered context engineering with 4 tiers mapped to 4 cache breakpoints, always-on daemon in Bun/TypeScript, self-modifiable crontab, sub-agent orchestration. Spec frozen. Zero dependencies beyond Bun runtime + Anthropic SDK.

---

## Session A: Project Foundation & Config

**Goal**: Scaffold the project, set up Bun/TypeScript, create the configuration system.

**Status**: COMPLETE

**Dependencies**: None (first session)

**Tasks**:
- [x] `bun init` — Initialize the Bun project with TypeScript
- [x] `tsconfig.json` — Strict TypeScript config
- [x] `package.json` — Minimal dependencies (anthropic SDK, eventsource-parser)
- [x] `src/config.ts` — Configuration type definitions and loader
  - [x] Config schema: auth token, model preferences, tier budgets, paths
  - [x] Load from `~/.jarvis/config.json` with defaults
  - [x] Environment variable overrides (JARVIS_AUTH_TOKEN, etc.)
- [x] `src/context/tokens.ts` — Token counting utilities
  - [x] `countTokens(text: string): number` — Approximate token count
  - [x] `assertBudget(text: string, budget: number): void` — Validate against budget
- [x] Tier directory structure — Create `mind/` scaffold
  - [x] `mind/tier1/` with seed identity.md
  - [x] `mind/tier2/` with seed projects.md
  - [x] `mind/tier3/` with seed recent.md
  - [x] `mind/conversations/active/` and `archive/`
  - [x] `mind/workshop/tools/`
- [x] Tests: Config loading from file and env vars (~8 tests)
- [x] Tests: Token counting accuracy (~6 tests)
- [x] Tests: Tier directory validation (~4 tests)

**Files to create**: `src/config.ts`, `src/context/tokens.ts`, `tsconfig.json`, `bunfig.toml`, `package.json`
**Files to modify**: None (greenfield)
**Estimated tests**: ~18

---

## Session B: Claude API Client

**Goal**: Build the Claude API client with streaming, caching, and setup-token auth.

**Dependencies**: Session A (config system)

**Status**: COMPLETE

**Tasks**:
- [x] `src/api/auth.ts` — Setup-token authentication
  - [x] `buildAuthHeaders(config)` — Build Bearer auth + API headers from config
  - [x] `checkUsage(config): Promise<UsageInfo>` — Query subscription usage
  - [x] `isValidTokenFormat(token)` — Validate setup-token format
  - [x] UsageInfo type with five_hour and seven_day utilization
- [x] `src/api/client.ts` — Claude API client
  - [x] `ClaudeClient.call(options): Promise<ClaudeResponse>` — Non-streaming API call
  - [x] `ClaudeClient.stream(options): AsyncGenerator<StreamEvent>` — Streaming API call
  - [x] `ClaudeClient.streamAndAccumulate(options, onDelta?)` — Stream + accumulate
  - [x] `buildRequest(options, config)` — Request construction with cache breakpoints
  - [x] Support for system prompt with cache_control breakpoints
  - [x] Support for tool definitions
  - [x] Proper error handling (rate limits, auth errors, network, overloaded)
- [x] `src/api/streaming.ts` — SSE stream handler
  - [x] `parseSSEStream(body): AsyncGenerator<StreamEvent>` — Parse SSE into typed events
  - [x] `accumulateStream(events, onDelta?)` — Accumulate final response from stream
  - [x] Handle text deltas, tool use deltas (partial JSON), message completion
  - [x] Handle mixed text + tool_use content blocks
  - [x] Track cache usage (creation + read tokens)
- [x] `src/api/types.ts` — API type definitions
  - [x] ClaudeRequest, ClaudeResponse, Message, ContentBlock
  - [x] ToolDefinition, ToolUseBlock, ToolResultBlock
  - [x] CacheControl, UsageInfo, SystemBlock
  - [x] All 8 stream event types (MessageStart/Stop, ContentBlockStart/Delta/Stop, MessageDelta, Ping, Error)
  - [x] ClaudeApiError class with isRateLimit/isAuth/isOverloaded/isServerError helpers
- [x] Tests: Auth headers and token validation (8 tests)
- [x] Tests: API request construction with cache breakpoints (10 tests)
- [x] Tests: SSE stream parsing and accumulation (12 tests)
- [x] Tests: Error handling and client behavior (11 tests)
- [x] Tests: ClaudeApiError type classification (6 tests)
- [x] Tests: Curator mock configs fixed for requestTimeoutMs (Session F fix)

**Files created**: `src/api/auth.ts`, `src/api/client.ts`, `src/api/streaming.ts`, `src/api/types.ts`
**Files modified**: None (config.ts already had all needed types from Session A)
**Actual tests**: 53 (estimated 24)

**Review pass 1** (verified against `docs/references/anthropic-docs/` and `anthropic-sdk-typescript/`):
- Added `stop_sequence: string | null` to ClaudeResponse (API returns it, we were silently dropping it)
- Expanded StopReason with `pause_turn` (server-side tool loops) and `refusal` (safety filter)
- Expanded MessageDeltaEvent usage to include optional `cache_creation_input_tokens`, `cache_read_input_tokens`, `input_tokens`
- Added `stopSequence` to AccumulatedResponse + propagation in accumulator
- Added `requestId` to ClaudeApiError + capture from `request-id` response header in error path
- Propagated cache usage fields from message_delta events in accumulator
- 7 new tests (50 total), zero TypeScript errors, all downstream mocks updated

**Review pass 2** (verified against `docs/references/anthropic-docs/caching.md`, `errors.md`, `handling-stop-reasons.md`, `streaming-messages.md`, `beta-headers.md`):
- Removed stale `anthropic-beta: prompt-caching-2024-07-31` header — caching is GA, all reference doc examples omit it, stale beta headers risk 400 errors per `beta-headers.md`
- Added `model_context_window_exceeded` to StopReason — available by default in Sonnet 4.5+ per `handling-stop-reasons.md`
- Added `isServerError` getter on ClaudeApiError for status 500 — `errors.md` lists `500 - api_error` explicitly, useful for retry logic
- Added `request_id` extraction from error JSON body as fallback — `errors.md` shows `request_id` as top-level field in error responses, header preferred when present
- Fixed pre-existing TS errors in curator test mocks (missing `requestTimeoutMs` from Session A review)
- 3 new tests (53 total), zero TypeScript errors, 318 tests passing across full suite

---

## Session C: Tiered Context System

**Goal**: Build the context assembler that reads tier files and constructs the cached API payload.

**Dependencies**: Session A (tokens), Session B (API types)

**Status**: COMPLETE

**Tasks**:
- [x] `src/context/tiers.ts` — Tier file management
  - [x] `readTier(mindDir, tierNum: 1|2|3): Promise<TierContent>` — Read and concatenate all files in a tier directory
  - [x] `writeTier(mindDir, tierNum: 2|3, filename, content): Promise<void>` — Write a tier file
  - [x] `tierTokenCount(mindDir, tierNum: 1|2|3): Promise<number>` — Count tokens in a tier
  - [x] `validateTierBudgets(config): Promise<TierBudgetReport>` — Check all tiers against budgets
- [x] `src/context/assembler.ts` — Context assembly engine
  - [x] `assembleContext(config, messages): Promise<AssembledContext>` — Full assembly
  - [x] `buildSystemBlocks(tier1, tier2, tier3): SystemBlock[]` — Cache breakpoint placement
  - [x] `truncateMessages(messages, budget)` — Tier 4 overflow with oldest-first drop
  - [x] Enforce token budgets per tier (T1: error, T2/T3: warn, T4: truncate)
  - [x] Return assembled system prompt array + messages array + budget report + warnings
- [x] `src/context/types.ts` — Context type definitions
  - [x] AssembledContext, TierContent, TierBudgetReport, TierBudgetEntry
  - [x] ContextWarning, FileTierNum, TierNum, TierStatus
- [x] Tests: Read single-file tier (3 tests)
- [x] Tests: Read multi-file tier with concatenation (4 tests)
- [x] Tests: Token budget validation (5 tests)
- [x] Tests: writeTier (4 tests)
- [x] Tests: tierTokenCount (2 tests)
- [x] Tests: Full context assembly with all 4 tiers (6 tests)
- [x] Tests: Overflow handling per tier (5 tests)
- [x] Tests: Cache breakpoint placement (5 tests)
- [x] Tests: truncateMessages unit (4 tests)

**Files created**: `src/context/types.ts`, `src/context/tiers.ts`, `src/context/assembler.ts`
**Files modified**: None
**Actual tests**: 38 (estimated 26)

---

## Session D: PTY Bash & Tool Engine

**Goal**: Build the foundational PTY bash capability and the tool execution system. PTY bash is the single most important tool — it enables Jarvis to use ANY CLI tool including Claude Code interactively.

**Dependencies**: Session B (API types for tool definitions)

**Status**: REVIEWED

**Tasks**:
- [x] `src/tools/bash.ts` — PTY-capable shell execution (THE FOUNDATION)
  - [x] `execBash(command, opts): Promise<BashResult>` — Non-interactive execution
  - [x] `execInteractive(command, opts): Promise<BashResult>` — PTY-allocated execution
  - [x] Bun.spawn with PTY allocation for interactive mode
  - [x] Plain child_process for simple commands
  - [x] ANSI output capture and optional stripping
  - [x] Timeout support, working directory, environment variables
  - [x] Output truncation for large results
  - [x] Input feeding for interactive prompts (stdin writes)
- [x] `src/tools/definitions.ts` — Core tool definitions
  - [x] bash (with interactive flag), read_file, write_file, ssh_exec, cron_manage, web_fetch
  - [x] Tool definitions as TypeScript objects matching API schema
  - [x] No spawn_agent tool — Claude Code IS the agent system
- [x] `src/tools/engine.ts` — Tool execution engine
  - [x] `executeTool(toolUse: ToolUse): Promise<ToolResult>` — Route and execute
  - [x] Timeout handling per tool
  - [x] Error capture and formatting
  - [x] Output truncation for large results
- [x] `src/tools/files.ts` — File operations
  - [x] `readFile(path, offset?, limit?): Promise<string>` — Read with optional range
  - [x] `writeFile(path, content): Promise<void>` — Write with directory creation
- [x] `src/tools/ssh.ts` — Remote execution
  - [x] `sshExec(host, command, timeout?): Promise<string>` — Execute via SSH
  - [x] Use native ssh command (no library dependency)
- [x] `src/tools/cron.ts` — Crontab self-management
  - [x] `cronList(): Promise<CronEntry[]>` — List current entries
  - [x] `cronAdd(schedule, command, id): Promise<void>` — Add entry
  - [x] `cronRemove(id): Promise<void>` — Remove entry
  - [x] Entries tagged with `# jarvis:<id>` for identification
- [x] Tests: PTY bash interactive execution (6 tests)
- [x] Tests: Non-interactive bash with timeout (8 tests)
- [x] Tests: ANSI stripping and output truncation (9 tests)
- [x] Tests: File read/write operations (7 tests)
- [x] Tests: SSH execution (3 tests)
- [x] Tests: Cron parse/serialize (8 tests)
- [x] Tests: Tool definitions validation (6 tests)
- [x] Tests: Tool engine routing and error handling (18 tests)

**Files created**: `src/tools/bash.ts`, `src/tools/definitions.ts`, `src/tools/engine.ts`, `src/tools/files.ts`, `src/tools/ssh.ts`, `src/tools/cron.ts`
**Files modified**: None
**Actual tests**: 65 (estimated 32)

**Review pass 1** (verified against `docs/references/anthropic-docs/implement-tool-use.md`, `bash-tool.md`, `tools-overview.md`, `web-fetch-tool.md`, `create-message.md`):
- Fixed SSH shell injection in `sshExec` — host and command were concatenated into a `bash -c` string without quoting. Added `shellQuote()` using POSIX single-quote escaping to neutralize metacharacters (`;`, `$()`, backticks)
- Enhanced `stripAnsi()` to handle DEC private mode CSI sequences — added `?` parameter prefix to regex, catching `\x1b[?25h` (cursor show/hide), `\x1b[?2004h` (bracketed paste mode) that are common in PTY output
- Enriched all 6 tool descriptions from 1 sentence to 3-6 sentences per API best practice: "Provide extremely detailed descriptions. This is by far the most important factor in tool performance." Each now explains what, when, how, and caveats
- Added `AbortController` timeout to `handleWebFetch` — a slow/hanging URL could block the entire conversation loop indefinitely. Now respects `timeout_ms` parameter (default 30s), returns clear "timed out" error
- Added `timeout_ms` to `web_fetch` tool definition — Claude can now control fetch timeouts per-request
- Added `input_examples` optional field to `ToolDefinition` — per API docs, helps Claude understand complex tool inputs (~20-50 tokens each)
- Added `cache_control` optional field to `ToolResultBlock` — enables prompt caching of large tool results for subsequent turns
- 15 new tests (80 total), zero TypeScript errors, 341 tests passing across full suite

---

## Session E: Daemon Core & Session Management

**Goal**: Build the always-on daemon with session lifecycle and multi-turn conversation loop.

**Dependencies**: Session B (API client), Session C (context assembler), Session D (tool engine)

**Status**: REVIEWED

**Tasks**:
- [x] `src/session/transcript.ts` — Transcript storage
  - [x] `appendMessage(mindDir, sessionId, message)` — Append to active JSONL transcript
  - [x] `loadTranscript(mindDir, sessionId): Message[]` — Load session messages (active or archived)
  - [x] `loadTranscriptEntries(mindDir, sessionId): TranscriptEntry[]` — Load with timestamps
  - [x] `archiveSession(mindDir, sessionId)` — Move active → archive
  - [x] `deleteTranscript(mindDir, sessionId)` — Cleanup for cancellation
  - [x] `hasActiveTranscript(mindDir, sessionId): boolean` — Check existence
  - [x] JSON Lines format (append-only, crash-safe, streamable)
  - [x] Malformed line resilience (skips bad JSON, keeps good entries)
- [x] `src/session/manager.ts` — Session lifecycle
  - [x] `SessionManager` class with mindDir, idle timeout, onSessionEnd callback
  - [x] `startSession(): Session` — Create new session (ends previous if active)
  - [x] `endSession(reason): SessionEndEvent | null` — End, archive, fire callback
  - [x] `getActiveSession(): Session | null` — Current active session
  - [x] `addMessage(message)` — Record to transcript + reset idle timer
  - [x] `getMessages(): Message[]` — Load full transcript
  - [x] `getSessionDurationMs(): number` — Track duration
  - [x] `destroy()` — Clean up timers
  - [x] Idle timeout detection (configurable, timer.unref() for clean process exit)
  - [x] Session metadata (id, startTime, status, messageCount)
  - [x] SessionEndEvent with reason, messageCount, durationMs
- [x] `src/conversation.ts` — Conversation loop logic
  - [x] `runConversation(client, options): AsyncGenerator<ConversationEvent>` — Full loop
  - [x] Handle tool calls (execute → feed result → continue)
  - [x] Handle multiple tool calls per response
  - [x] Handle multi-round tool loops (tool → tool → text)
  - [x] Handle text responses (yield text deltas)
  - [x] Handle stop reasons (end_turn, max_tokens, tool_use)
  - [x] Max turns protection (default 25, prevents runaway loops)
  - [x] Error classification (recoverable: rate limits, overloaded)
  - [x] `collectText()` helper for non-streaming callers
  - [x] 6 event types: text_delta, tool_call, tool_result, turn_complete, error
  - [x] Usage tracking (input/output/cache creation/cache read tokens)
- [x] `src/daemon.ts` — Main daemon process
  - [x] `Daemon` class with config, client, sessions
  - [x] `start()` — Initialize daemon, install signal handlers
  - [x] `shutdown()` — Graceful shutdown, end session, clean up
  - [x] `handleMessage(text): AsyncGenerator<ConversationEvent>` — Full pipeline
  - [x] Auto-start on first message (idle → running)
  - [x] Auto-create session on first message
  - [x] Context assembly (tiers 1-3 from files + tier 4 from transcript)
  - [x] Multi-turn conversation loop with tool execution
  - [x] Streaming output via async generator
  - [x] Graceful shutdown (SIGINT/SIGTERM handlers)
  - [x] Persist new messages (assistant responses, tool results) to transcript
  - [x] `getStats()` — Status, session ID, message count, uptime
  - [x] `onSessionEnd` callback for curators
- [x] Tests: Transcript (19 tests)
  - [x] Path helpers, append, load, archive, delete, hasActive, malformed resilience
- [x] Tests: Session lifecycle (17 tests)
  - [x] Start, end, active check, end reasons, message recording, idle timeout, duration, destroy
- [x] Tests: Conversation loop (13 tests)
  - [x] Text response, tool use, multi-tool, multi-round, error handling, max turns, usage, stop reasons
- [x] Tests: Daemon (16 tests)
  - [x] Lifecycle (idle/running/shutdown), session management, message edge cases, callbacks, stats

**Files created**: `src/session/transcript.ts`, `src/session/manager.ts`, `src/daemon.ts`, `src/conversation.ts`
**Files modified**: None
**Actual tests**: 65 (estimated 28)

**Review pass 1** (verified against `docs/references/anthropic-docs/handling-stop-reasons.md`, `errors.md`, `streaming-messages.md`, `implement-tool-use.md`):
- Fixed critical `persistNewMessages` truncation bug in `daemon.ts` — when tier4 budget truncated the messages array (e.g., 100 messages → 80), `persistNewMessages` used the full transcript length as start index, causing `for (let i = 100; i < 82; i++)` to never execute. Assistant responses and tool results silently lost during long conversations. Fixed by snapshotting `messages.length` before the conversation loop runs.
- Replaced fragile string-matching `isRecoverableError` with typed `ClaudeApiError` detection — was matching `"429"`, `"rate"`, `"529"`, `"overloaded"` against `error.message`, which could false-positive on unrelated errors. Now uses `ClaudeApiError.isRateLimit`, `.isOverloaded`, `.isServerError` getters. Falls back to string matching only for non-API errors (network timeouts, ECONNRESET).
- Added `pause_turn` stop reason handling to conversation loop — per `handling-stop-reasons.md`, server-side tools (web search, code execution) return `pause_turn` when hitting their iteration limit. The conversation loop now continues by looping back (assistant message already pushed), instead of incorrectly treating it as a terminal stop. Future-proofs for server tool adoption.
- 6 new tests (71 total): 5 error recovery tests (ClaudeApiError rate limit, overloaded, server error, auth non-recoverable, network timeout recoverable, generic non-recoverable), 2 stop reason tests (pause_turn continues loop, refusal is terminal)

---

## Session F: Post-Interaction Curators

**Goal**: Build the curator system that updates Tier 2 and 3 after each session.

**Dependencies**: Session B (API client for sub-agent calls), Session E (session/transcript)

**Status**: COMPLETE

**Tasks**:
- [x] `src/curators/orchestrator.ts` — Curation coordinator
  - [x] `runCuration(config, event): Promise<CurationResult>` — Trigger all curators
  - [x] Run curators in parallel (Tier 2, 3, and Archive via Promise.allSettled)
  - [x] Handle failures gracefully (capture in errors array, continue others)
  - [x] `triggerCuration()` — Fire-and-forget from daemon perspective
- [x] `src/curators/tier2.ts` — Medium-term curator
  - [x] Read session transcript
  - [x] Read current tier2 files (projects.md, skills.md, focus.md)
  - [x] Call Claude (Sonnet) with curation prompt
  - [x] Parse response into file updates (XML-delimited format)
  - [x] Atomic write with backup
- [x] `src/curators/tier3.ts` — Short-term curator
  - [x] Read session transcript
  - [x] Read current tier3 files (recent.md, tasks.md, context.md)
  - [x] Call Claude (Haiku) with curation prompt
  - [x] Write session summary to recent.md
  - [x] Update tasks.md and context.md
  - [x] Enforce recency window (keep last N sessions, default 5)
  - [x] Atomic write with backup (.tmp → .bak → rename)
- [x] `src/curators/archive.ts` — Transcript archival
  - [x] Write companion .meta.json alongside archived transcript
  - [x] Metadata: sessionId, endedAt, reason, messageCount, durationMs, transcriptPath
  - [x] Load metadata and list archived sessions
- [x] `src/curators/prompts.ts` — Curation prompt templates
  - [x] formatTranscript() — Compact transcript formatting for curator prompts
  - [x] buildTier2Prompt() — Projects/skills/focus curation with conservation guidelines
  - [x] buildTier3Prompt() — Session summary/tasks/context with recency window
  - [x] parseCuratorResponse() — XML-delimited file extraction from model response
- [x] `src/daemon.ts` — Wired curation into daemon lifecycle
  - [x] handleSessionEnd triggers triggerCuration (fire-and-forget)
  - [x] onCurationComplete callback for external observers
- [x] Tests: Prompts — formatTranscript, parseCuratorResponse, prompt builders (19 tests)
- [x] Tests: Archive — metadata write/load, session listing (11 tests)
- [x] Tests: Tier 3 — atomic write with backup, curation with mock API (11 tests)
- [x] Tests: Tier 2 — curation with mock API, Sonnet model, file updates (6 tests)
- [x] Tests: Orchestrator — parallel execution, error isolation, fire-and-forget (8 tests)

**Files created**: `src/curators/orchestrator.ts`, `src/curators/tier2.ts`, `src/curators/tier3.ts`, `src/curators/archive.ts`, `src/curators/prompts.ts`
**Files modified**: `src/daemon.ts` (wired curation trigger into handleSessionEnd)
**Actual tests**: 55 (estimated 26)

**Review pass 1** (verified against `docs/references/anthropic-api-caching.md`, `anthropic-api-messages.md`):
- Added full cache token tracking to `CuratorTokenUsage` — curators only tracked `input_tokens` and `output_tokens`, missing `cache_creation_input_tokens` and `cache_read_input_tokens`. Per API docs, `total_input = cache_read + cache_creation + input`. Both Tier 2 and Tier 3 results now include `cacheCreation` and `cacheRead` fields with `?? 0` fallback for non-cached calls.
- Extracted shared `readTierFile()` and `extractText()` into `src/curators/helpers.ts` — both functions were duplicated identically in `tier2.ts` and `tier3.ts`. Single source of truth prevents divergence bugs.
- Added rogue filename whitelist tests — verified that model output containing path traversal (`../../etc/passwd`) or unexpected filenames (`secrets.md`) is silently ignored. Only whitelisted TIER2_FILES/TIER3_FILES are written to disk. Security property now tested.
- 14 new tests (69 total): 5 helpers tests (readTierFile, extractText with mixed blocks), 3 tier3 tests (rogue filenames, cache usage fields, cache defaults to zero), 3 tier2 tests (rogue filenames, cache usage fields), plus existing tests updated for new CuratorTokenUsage shape.

---

## Session G: Heartbeat & Self-Scheduling

**Goal**: Build the self-scheduling system — cron integration, wake mechanism, rate limit tracking.

**Dependencies**: Session D (cron tool), Session E (daemon), Session F (curators)

**Status**: COMPLETE

**Tasks**:
- [x] `src/heartbeat/rate-limits.ts` — Usage tracking
  - [x] `checkLimits(config): Promise<RateLimitStatus>` — Query current usage via auth.ts
  - [x] `fromUsageInfo(usage): RateLimitStatus` — Normalize API response
  - [x] `shouldThrottle(status, threshold?): boolean` — Decision: proceed or defer
  - [x] `selectModel(status, preferred): string` — Downgrade model if near limits
  - [x] `loadUsageHistory(mindDir)` / `recordUsage(mindDir, status)` — Persistent usage history
  - [x] Model downgrade chain: opus → sonnet → haiku (50%/80% thresholds)
  - [x] History capped at 100 entries, stored in mind/heartbeat/usage-history.json
- [x] `src/heartbeat/tasks.ts` — Built-in autonomous tasks
  - [x] TaskDefinition type (name, description, systemPrompt, userMessage, allowTools, preferredModel)
  - [x] `morning_routine` — Review context, prioritize tasks, write morning note (tools: yes)
  - [x] `check_rate_limits` — Quick diagnostic of usage patterns (tools: no, model: haiku)
  - [x] `weekly_review` — Archive cleanup, tier2/3 review, weekly summary (tools: yes)
  - [x] `getTask(name)`, `listTasks()`, `registerTask(task)` — Task registry
- [x] `src/heartbeat/cron.ts` — Crontab management (enhanced)
  - [x] `buildDefaultSchedule(): ScheduleEntry[]` — 3 default cron entries
  - [x] `installDefaultSchedule(daemonPath): Promise<void>` — Set initial cron jobs
  - [x] `getSchedule(): Promise<ScheduleEntry[]>` — List as ScheduleEntries
  - [x] `updateSchedule(entries, daemonPath): Promise<void>` — Full schedule replace
  - [x] `extractTaskName(command): string | null` — Parse task from cron command
  - [x] Builds on src/tools/cron.ts (parse/serialize layer)
- [x] `src/heartbeat/wake.ts` — Wake from cron handler
  - [x] `handleWake(taskName, config): Promise<WakeResult>` — Full one-shot pipeline
  - [x] Task lookup → rate limit check → context assembly → conversation → log
  - [x] Throttle detection: defers task if utilization > 80%
  - [x] Model downgrade based on current utilization
  - [x] Graceful fallthrough: rate limit check failure doesn't block task execution
  - [x] Error-aware conversation: throws on API errors (unlike collectText)
  - [x] JSON logs to mind/heartbeat/logs/ with timestamp
  - [x] Uses assembleContext + runConversation (not full Daemon class)
- [x] `src/daemon.ts` — Wired wake into Daemon class
  - [x] `daemon.wake(taskName): Promise<WakeResult>` — Delegates to handleWake
  - [x] One-shot execution, does not use session manager
- [x] Tests: Rate limit checking and throttling (8 tests)
- [x] Tests: Model downgrade logic (9 tests)
- [x] Tests: Usage history persistence (6 tests)
- [x] Tests: Task registry and content quality (9 tests)
- [x] Tests: Crontab schedule building and task extraction (11 tests)
- [x] Tests: Wake handler pipeline (13 tests)
- [x] Tests: Daemon wake integration (4 tests)

**Files created**: `src/heartbeat/rate-limits.ts`, `src/heartbeat/tasks.ts`, `src/heartbeat/cron.ts`, `src/heartbeat/wake.ts`
**Files modified**: `src/daemon.ts` (added `wake` method + heartbeat imports)
**Actual tests**: 60 (estimated 24)

---

## Session H: CLI Interface & Polish

**Goal**: Build the interactive CLI interface and polish the end-to-end experience.

**Dependencies**: Session E (daemon core)

**Status**: COMPLETE

**Tasks**:
- [x] `src/senses/cli.ts` — Interactive CLI
  - [x] Readline-based input loop
  - [x] Streaming output display (text deltas rendered in real-time)
  - [x] Context stats display on startup (tier token counts)
  - [x] Commands: `/quit`, `/status`, `/session`, `/tiers`, `/help`
  - [x] Tool call display (show what tools Jarvis is using with compact summaries)
  - [x] Graceful Ctrl+C handling (interrupt during processing, shutdown when idle)
- [x] `src/cli-entry.ts` — CLI entry point
  - [x] `jarvis` — Start interactive session
  - [x] `jarvis wake --task <name>` — Cron wake (with `--task` flag or positional arg)
  - [x] `jarvis status` — Show vessel status (model, mind dir, tier stats)
  - [x] `jarvis tiers` — Show tier token counts with progress bars
  - [x] `jarvis tasks` — List available autonomous tasks
  - [x] `jarvis help` / `--help` / `-h` — Show usage
- [x] End-to-end integration
  - [x] Wire CLI → Daemon → Context → API → Tools → Response → CLI
  - [x] Full event rendering pipeline (text_delta, tool_call, tool_result, turn_complete, error)
- [x] Error display formatting
  - [x] User-friendly error messages with [error]/[warning] prefixes
  - [x] Distinction between recoverable (warning, will retry) and fatal errors
  - [x] Tool error results distinguished from success results
- [x] Tests: CLI command parsing (7 tests — parseCommand known/unknown/case/whitespace/args)
- [x] Tests: Tool call and result formatting (11 tests — all 6 tools + unknown + truncation + errors)
- [x] Tests: Status and tier display formatting (8 tests — stats/durations/tiers/progress bars/percentages)
- [x] Tests: Streaming output rendering (8 tests — deltas/tools/usage/errors/full conversation)
- [x] Tests: CLI entry arg parsing (10 tests — all commands, case sensitivity, missing args)
- [x] Tests: End-to-end display scenarios (5 tests — empty tiers, full tiers, all status fields)

**Files created**: `src/senses/cli.ts`, `src/cli-entry.ts`
**Files modified**: `package.json` (added `bin` entry + `start` script)
**Actual tests**: 51 (estimated 17)

---

## Session I: Messaging Integration (Telegram)

**Goal**: Add Telegram bot as the primary remote messaging channel.

**Dependencies**: Session E (daemon), Session I (CLI as reference)

**Status**: COMPLETE

**Tasks**:
- [x] `src/senses/telegram.ts` — Telegram bot integration
  - [x] Bot initialization with token from config (getMe validation on start)
  - [x] Message handler (text messages → daemon, accumulate response, send back)
  - [x] Response sending (stream-accumulated → single message, split if >4096 chars)
  - [x] Commands: `/status`, `/session`, `/tiers`, `/start`, `/help`
  - [x] Error handling (API errors → user-friendly message, MarkdownV2 fallback to plain)
  - [x] Connection management (exponential backoff retry on polling errors)
- [x] Telegram-specific formatting
  - [x] MarkdownV2 formatting for code blocks (preserve backticks, escape rest)
  - [x] Code block handling (regex extraction, per-block formatting)
  - [x] Long message splitting (4096 char limit, newline > space > hard split)
- [x] Config updates for Telegram
  - [x] Bot token in config (telegramToken field + JARVIS_TELEGRAM_TOKEN env var)
  - [x] Allowed chat IDs (telegramAllowedChats + JARVIS_TELEGRAM_CHATS env var, comma-separated)
  - [x] "typing" indicator while processing (sendChatAction refreshed during tool execution)
- [x] Daemon integration
  - [x] `startTelegram()` / `stopTelegram()` / `getTelegramBot()` on Daemon class
  - [x] `shutdown()` automatically stops Telegram bot
  - [x] `createTelegramBot()` factory returns null if token not configured
- [x] CLI entry integration
  - [x] `jarvis telegram` command starts long-polling bot
  - [x] Graceful SIGINT/SIGTERM shutdown
  - [x] Error if no token configured
- [x] Tests: Telegram API helpers — callApi URL/params/success/error (5 tests)
- [x] Tests: Message splitting — short/exact/newline/space/hard/empty (6 tests)
- [x] Tests: MarkdownV2 escaping — special chars/all chars/normal/empty (4 tests)
- [x] Tests: Format for Telegram — plain/code blocks/escape outside (3 tests)
- [x] Tests: Bot command extraction — all commands/suffix/unknown/position/entities/case (8 tests)
- [x] Tests: Access control — empty list/allowed/rejected/negative IDs (4 tests)
- [x] Tests: Bot commands — help/start/status/session/tiers (5 tests)
- [x] Tests: Access control integration — rejected/allowed/open mode (3 tests)
- [x] Tests: Message handling — no message/no text/typing indicator (3 tests)
- [x] Tests: Lifecycle — isRunning/start/stop/idempotent/connection failure (6 tests)
- [x] Tests: Factory — null without token/creates with token/passes config (3 tests)
- [x] Tests: Config env vars — token/chats (2 tests)
- [x] Tests: CLI entry — parseArgs telegram/case-insensitive (2 tests)
- [x] Tests: Daemon integration — startTelegram no-op/stopTelegram safe/shutdown stops (3 tests)

**Files created**: `src/senses/telegram.ts`
**Files modified**: `src/config.ts` (env var overrides), `src/daemon.ts` (telegram lifecycle), `src/cli-entry.ts` (telegram command)
**Actual tests**: 57 (estimated 21)

---

## Session Log

- **Session 0**: Planning & Reconnaissance — Deployed 4 parallel recon agents (Alpha: Claude API caching/auth, Bravo: Proxmox infrastructure, Charlie: existing memory-ts hooks, Delta: OpenClaw subscription handling). Discovered 4 API cache breakpoints map perfectly to 4 memory tiers. Setup-token enables Max subscription auth at zero marginal cost. Key architectural decisions: Direct API for cache-controlled core interactions, Claude Code as agent/team tool (not runtime), PTY bash as foundational capability enabling Jarvis to use any CLI interactively (including Claude Code itself). Spec frozen: Bun/TypeScript daemon, 2 production deps, 9 sessions (A-I), ~216 estimated tests. The vessel builds itself. 0 new tests (0 total).
- **Session B**: Claude API Client — Built raw-fetch Claude API client with full cache breakpoint control (the core innovation). Four modules: types.ts (complete API type system with 8 stream event types, ClaudeApiError class), auth.ts (Bearer setup-token auth headers, usage checking, token format validation), streaming.ts (SSE parsing via eventsource-parser → async generator, stream accumulator with text delta callbacks, partial JSON reconstruction for tool use), client.ts (ClaudeClient class with call/stream/streamAndAccumulate methods, buildRequest with system block cache_control placement, error handling for 401/429/502/529/network). Design decision: raw fetch instead of SDK for full control over cache breakpoints between tiers — the SDK abstracts away the exact cache_control placement that Jarvis needs. No config.ts changes needed (Session A types were sufficient). Zero TypeScript errors, zero warnings. 43 new tests (75 total).
- **Session C**: Tiered Context System — Built the core innovation: the context assembler that reads tier files and constructs cached API payloads. Three modules: types.ts (AssembledContext, TierContent, TierBudgetReport, ContextWarning, FileTierNum/TierNum type constraints), tiers.ts (readTier concatenates alphabetically-sorted .md files with \n\n separator, writeTier for Tier 2/3 only, tierTokenCount, validateTierBudgets with per-tier status reporting), assembler.ts (assembleContext reads all tiers from disk, enforces budgets per spec — Tier 1 throws BudgetExceededError, Tier 2/3 warn for curator attention, Tier 4 truncates oldest messages keeping at least the last one). buildSystemBlocks places cache breakpoints: Tier 1 and 2 get 1h TTL ephemeral cache, Tier 3 gets 5m TTL, empty tiers omitted entirely. truncateMessages implements oldest-first dropping with always-keep-last guarantee. Message token counting handles both string content and ContentBlock arrays (text, tool_use, tool_result). Budget report tracks all 4 tiers with tokens/budget/status/overage. Zero TypeScript errors, zero unused imports. 38 new tests (113 total).
- **Session D**: PTY Bash & Tool Engine — Built the foundational capability layer: the hands of the vessel. Six modules, zero new dependencies. bash.ts: dual-mode shell execution — execBash() via Bun.spawn with piped stdout/stderr for simple commands, execInteractive() via system `script` command for PTY-allocated interactive sessions (Claude Code, TUIs, ssh) — zero npm deps for PTY, just the native binary. Both modes support timeout, working directory, env vars, stdin feeding. stripAnsi() handles SGR/CSI/OSC sequences + CR/LF normalization. truncateOutput() preserves head+tail with middle notice. files.ts: readFile with offset/limit for large files, writeFile with auto mkdir -p. ssh.ts: remote execution via native ssh binary with BatchMode=yes (never hangs on password), StrictHostKeyChecking=accept-new, ConnectTimeout derived from timeout_ms. cron.ts: self-managed crontab with `# jarvis:<id>` tagging — parseCrontab/serializeCrontab for pure parsing, cronList/cronAdd/cronRemove for live crontab manipulation. System entries never touched. definitions.ts: 6 core tools (bash, read_file, write_file, ssh_exec, cron_manage, web_fetch) with TOOL_NAMES constants as single source of truth. No spawn_agent — Claude Code IS the agent system. engine.ts: executeTool routes ToolUseBlock to handlers, never throws (errors become ToolResult with is_error:true), executeToolForApi wraps results as ToolResultBlock with correct tool_use_id. Web fetch uses native Bun fetch. Output truncated to 50K chars for API results. Zero TypeScript errors, zero warnings, zero unused code. 65 new tests (178 total).
- **Session E**: Daemon Core & Session Management — Built the vessel's heartbeat: the daemon, conversation loop, session management, and transcript storage. Four modules, zero new dependencies. transcript.ts: JSONL append-only storage (crash-safe, streamable) — appendMessage/loadTranscript/archiveSession/deleteTranscript, malformed-line resilience (skips bad JSON). manager.ts: SessionManager class with idle timeout (configurable, timer.unref() for clean exit), auto-archive on end, SessionEndEvent callback for curators, 4 end reasons (user_quit/idle_timeout/shutdown/new_session). conversation.ts: multi-turn async generator loop — message → API → response → if tool_use: execute all tools, feed results, loop back; if end_turn/max_tokens: done. 6 event types (text_delta, tool_call, tool_result, turn_complete, error) for real-time streaming display. Max turns protection (default 25) prevents runaway tool loops. Error classification: rate limits and overloaded marked recoverable. Usage tracking (input/output/cache creation/cache read tokens). collectText() helper for non-streaming callers. daemon.ts: Daemon class orchestrating config → client → sessions → context assembly → conversation loop. handleMessage() is an AsyncGenerator<ConversationEvent> — auto-starts daemon, auto-creates session, assembles tiered context from files, runs conversation loop, persists new messages (assistant + tool results) to transcript. Graceful SIGINT/SIGTERM shutdown. getStats() for monitoring. onSessionEnd callback wired for future curators. Zero TypeScript errors, zero warnings, zero unused code. 65 new tests (243 total).
- **Session F**: Post-Interaction Curators — Built the sleep consolidation cycle: the memory system that updates Tier 2 and Tier 3 after each session ends. Five modules, zero new dependencies. prompts.ts: formatTranscript() compresses ContentBlock messages into compact curator-friendly format (tool uses → summaries, long results → truncated), buildTier3Prompt/buildTier2Prompt inject current tier content + transcript with XML-delimited output format, parseCuratorResponse() extracts file updates from `<file name="X">` tags. archive.ts: writes companion .meta.json alongside archived transcripts (sessionId, endedAt, reason, messageCount, durationMs), loadArchiveMetadata/listArchivedSessions for future search. tier3.ts: Haiku-powered short-term curator — reads archived transcript, reads current tier3/recent.md+tasks.md+context.md, calls API with curation prompt, parses XML response, atomicWriteWithBackup() for each file (write .tmp, backup to .bak, atomic rename). Recency window via prompt instruction (keep last N sessions, default 5). tier2.ts: Sonnet-powered medium-term curator — same pattern but updates tier2/projects.md+skills.md+focus.md with higher-quality reasoning. Conservative guidelines: only update what evidence supports, preserve unchanged content. orchestrator.ts: runCuration() runs all three curators via Promise.allSettled (parallel, independent, failure-isolated). CurationResult includes per-curator results and errors array. triggerCuration() for fire-and-forget from daemon. daemon.ts wired: handleSessionEnd now fires triggerCuration automatically — the sleep consolidation cycle runs whenever a session ends. Zero TypeScript errors, zero warnings, zero unused code. 55 new tests (298 total).
- **Session G**: Heartbeat & Self-Scheduling — Built the autonomous nervous system: rate limit awareness, task scheduling, wake handler, and cron management. Four heartbeat modules, zero new dependencies. rate-limits.ts: checkLimits() queries API via auth.ts, fromUsageInfo() normalizes response, shouldThrottle() compares against 80% threshold (configurable), selectModel() implements three-tier downgrade chain (opus→sonnet at 50%, opus→haiku at 80%) using max of 5h/7d utilization windows. Usage history persisted to mind/heartbeat/usage-history.json (capped at 100 entries). tasks.ts: TaskDefinition type with systemPrompt, userMessage, allowTools, preferredModel. Three built-in tasks: morning_routine (review context, prioritize, write morning note — tools enabled), check_rate_limits (quick diagnostic — tools disabled, haiku model), weekly_review (archive cleanup, tier review, weekly summary — tools enabled). Registry pattern with getTask/listTasks/registerTask. cron.ts: higher-level schedule management built on tools/cron.ts — buildDefaultSchedule() returns 3 ScheduleEntries (morning 7AM daily, rate limits every 6h, weekly Sunday 2AM), installDefaultSchedule/getSchedule/updateSchedule manage the crontab, extractTaskName() parses task names from cron commands. wake.ts: one-shot autonomous pipeline — handleWake() does task lookup → rate limit check → model selection → context assembly → conversation → JSON log. Key design: does NOT use full Daemon class — lightweight pipeline reusing assembleContext + runConversation. Error-aware conversation iteration (throws on error events, unlike collectText). Graceful fallthrough: rate limit check failure doesn't block task execution. Logs to mind/heartbeat/logs/ with timestamped JSON. daemon.ts: added wake(taskName) method delegating to handleWake. Zero TypeScript errors, zero warnings, zero unused code. 60 new tests (421 total).
- **Session H**: CLI Interface & Polish — Built the vessel's first sense: the interactive terminal interface. Two modules, zero new dependencies. cli.ts: readline-based input loop with async-for-await iteration, streaming ConversationEvent rendering (text_delta → stdout, tool_call → compact summary with tool-specific formatting, tool_result → truncated display, turn_complete → token usage stats, error → recoverable/fatal distinction). Five slash commands (/quit, /status, /session, /tiers, /help). Startup banner shows tier token counts and model. Graceful Ctrl+C handling (interrupt during processing vs shutdown when idle). Formatting helpers: progressBar() with # fill, formatDuration() for uptime (seconds/minutes/hours), compactInput() per-tool summaries (bash→command, read_file→path, ssh_exec→host:command, web_fetch→url). cli-entry.ts: single entry point with minimal arg parsing — `jarvis` (interactive), `jarvis wake --task <name>` (cron), `jarvis status` (vessel info), `jarvis tiers` (token usage), `jarvis tasks` (list autonomous tasks), `jarvis help`. Config validation on startup with user-friendly error messages. Wake command delegates to Daemon.wake() with success/throttled/error reporting. package.json updated with `bin` entry for global install. Full end-to-end pipeline wired: CLI → Daemon → Context Assembly → API → Tool Engine → ConversationEvents → CLI rendering. Zero TypeScript errors, zero warnings, zero unused code. 51 new tests (472 total).
- **Session I**: Messaging Integration (Telegram) — Built the vessel's second sense: remote communication via Telegram. One module, zero new dependencies. telegram.ts: TelegramBot class with long-polling via getUpdates (30-second timeout), exponential backoff retry on errors (5s base, 60s max), getMe validation on start. callTelegramApi() wraps raw fetch → Telegram Bot API (POST + JSON, typed response envelope). Access control: isChatAllowed() with allowedChats whitelist (empty = open mode, for development). Bot commands (/status, /session, /tiers, /start, /help) handled directly, text messages routed through daemon.handleMessage() with full ConversationEvent accumulation. Response pipeline: sendChatAction("typing") before processing (refreshed during tool execution), text deltas accumulated, tool calls summarized as fallback content, formatForTelegram() detects code blocks and formats as MarkdownV2 (escapes special chars outside code, preserves backticks inside), falls back to plain text on formatting errors. splitMessage() handles Telegram's 4096-char limit (prefers newline > space > hard split). createTelegramBot() factory returns null if no token configured. Config: JARVIS_TELEGRAM_TOKEN and JARVIS_TELEGRAM_CHATS (comma-separated IDs) env var overrides. Daemon: startTelegram()/stopTelegram()/getTelegramBot() methods, shutdown() auto-stops bot. CLI: `jarvis telegram` command starts the long-polling bot with SIGINT/SIGTERM shutdown. Zero TypeScript errors, zero warnings, zero unused code, zero new dependencies. 57 new tests (529 total).
- **Session A**: Project Foundation & Config — Scaffolded the Bun/TypeScript project with strict tsconfig (noUnusedLocals, noUnusedParameters, noPropertyAccessFromIndexSignature). Installed 2 production deps (@anthropic-ai/sdk@0.78.0, eventsource-parser@3.0.6). Built config system: loads from ~/.jarvis/config.json with sensible defaults, merges partial tier budgets, env var overrides (JARVIS_AUTH_TOKEN, JARVIS_MODEL, JARVIS_MIND_DIR, JARVIS_API_URL, JARVIS_SESSION_TIMEOUT_MS), validates auth token presence, budget positivity, and total budget ceiling. Token counting utilities: chars/4 approximation (fast, slightly overestimates for safety), assertBudget with BudgetExceededError, fitsInBudget, remainingBudget. Mind directory scaffold: tier1/ (seed identity.md), tier2/ (seed projects.md), tier3/ (seed recent.md), conversations/active+archive, workshop/tools. Mind directory validation and auto-creation (ensureMindDir). Zero TypeScript errors, zero warnings. 32 new tests (32 total).

---

## Architecture Notes

### Token Budget Allocation (200K context)
- Tier 1 (Long-term): ~20K tokens — Identity, knowledge, preferences, tool definitions
- Tier 2 (Medium-term): ~25K tokens — Projects, skills, focus areas
- Tier 3 (Short-term): ~15K tokens — Recent sessions, tasks, immediate context
- Tier 4 (Current): ~140K tokens — Live conversation
- **Total**: ~200K tokens

### Cache Economics (Max Subscription)
- Tier 1 (1h TTL): Cached across sessions. Written once per hour max.
- Tier 2 (1h TTL): Cached across sessions. Updated after curation.
- Tier 3 (5m TTL): Cached within rapid exchanges. Updated frequently.
- Tier 4 (no cache): Always new tokens. Only this tier costs quota.
- **Result**: For rapid exchanges within 5 minutes, only new messages consume quota.

### Dependency Count Target
- Runtime: Bun
- Production deps: @anthropic-ai/sdk, eventsource-parser (if not using SDK streaming)
- Dev deps: bun test (built-in)
- **Total: 1-2 production dependencies**

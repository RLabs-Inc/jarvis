#!/usr/bin/env bash
set -euo pipefail

# === Configuration ===
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SPEC_FILE="docs/JARVIS_SPEC.md"
PROGRESS_FILE="docs/JARVIS_PROGRESS.md"
REFS_DIR="docs/references"
MEMORY_SYNC_SECONDS=90
LOG_DIR="$PROJECT_DIR/logs/sessions"

# === Session Definitions ===
# Format: LETTER|TITLE|MODE|REFS|CUSTOM_CONTEXT
# MODE: review (A-F, already built) | build (G-I, not yet built)
# REFS: comma-separated reference paths relative to docs/references/
SESSIONS=(
    "A|Project Foundation & Config|review|bun/docs/runtime,bun/docs/project|REVIEW SESSION: This session was already implemented. The code exists and 298 tests pass. Your job is to REVIEW and UPGRADE the existing implementation using the reference documentation.

REFERENCE DOCS AVAILABLE:
- docs/references/bun/docs/runtime/ — Bun runtime APIs (file I/O, env, process, plugins)
- docs/references/bun/docs/project/ — Bun project config (bunfig.toml, tsconfig, package.json)
- docs/references/bun/CLAUDE.md — Bun project conventions and patterns

WHAT TO DO:
1. Read the frozen spec: docs/JARVIS_SPEC.md
2. Read the progress tracker: docs/JARVIS_PROGRESS.md
3. Read the EXISTING source files for Session A (src/config.ts, src/context/tokens.ts, src/mind.ts)
4. Read the relevant Bun docs listed above
5. Compare implementation against docs — are we using the best Bun APIs? Any deprecations? Better patterns?
6. Fix, upgrade, or enhance anything that the docs reveal we missed
7. Run ALL tests with: bun test — ensure nothing breaks
8. Update the progress tracker session log with what you changed

DO NOT rewrite from scratch. Surgical improvements only. If the code is already correct, say so and move on."

    "B|Claude API Client|review|anthropic-docs,anthropic-sdk-typescript/src|REVIEW SESSION: This session was already implemented. The code exists and 298 tests pass. Your job is to REVIEW and UPGRADE the existing implementation using the reference documentation.

REFERENCE DOCS AVAILABLE:
- docs/references/anthropic-docs/create-message.md — Messages API (request/response format)
- docs/references/anthropic-docs/streaming-messages.md — SSE streaming protocol
- docs/references/anthropic-docs/caching.md — Prompt caching (breakpoints, TTLs, pricing)
- docs/references/anthropic-docs/errors.md — Error codes and handling
- docs/references/anthropic-docs/token-counting.md — Token counting API
- docs/references/anthropic-docs/handling-stop-reasons.md — Stop reason handling
- docs/references/anthropic-docs/tools-overview.md — Tool use format
- docs/references/anthropic-docs/implement-tool-use.md — Tool implementation patterns
- docs/references/anthropic-docs/fine-grained-tool-streaming.md — Tool streaming details
- docs/references/anthropic-docs/models.md — Available models and capabilities
- docs/references/anthropic-sdk-typescript/src/ — Official SDK source (for API patterns reference)

WHAT TO DO:
1. Read the frozen spec and progress tracker
2. Read the EXISTING source files (src/api/auth.ts, src/api/client.ts, src/api/streaming.ts, src/api/types.ts)
3. Read the Anthropic API docs listed above (especially caching.md, streaming-messages.md, create-message.md)
4. Verify our cache_control format matches the actual API docs
5. Verify our SSE event types match the actual streaming protocol
6. Verify our error handling covers all documented error codes
7. Check if there are API features we should be using (token counting endpoint, etc.)
8. Fix, upgrade, or enhance based on what the docs reveal
9. Run ALL tests: bun test — ensure nothing breaks
10. Update the progress tracker session log

CRITICAL: This is the API layer. Getting it exactly right per the docs matters more here than anywhere else. Read the docs thoroughly."

    "C|Tiered Context System|review|anthropic-docs|REVIEW SESSION: This session was already implemented. The code exists and 298 tests pass. Your job is to REVIEW and UPGRADE the existing implementation using the reference documentation.

REFERENCE DOCS AVAILABLE:
- docs/references/anthropic-docs/caching.md — Prompt caching (THE critical doc for this session)
- docs/references/anthropic-docs/context-window.md — Context window limits and behavior
- docs/references/anthropic-docs/token-counting.md — Token counting specifics
- docs/references/anthropic-docs/using-messages-api.md — Messages API usage patterns

WHAT TO DO:
1. Read the frozen spec and progress tracker
2. Read the EXISTING source files (src/context/tiers.ts, src/context/assembler.ts, src/context/types.ts)
3. Read caching.md THOROUGHLY — this is the core innovation, every cache_control detail matters
4. Verify our cache breakpoint placement matches the actual API caching behavior
5. Verify TTL values, ephemeral cache semantics, breakpoint limits
6. Check context window handling against docs
7. Fix, upgrade, or enhance based on what the docs reveal
8. Run ALL tests: bun test — ensure nothing breaks
9. Update the progress tracker session log

THIS IS THE CORE INNOVATION. The entire economic model depends on cache breakpoints working exactly as documented."

    "D|PTY Bash & Tool Engine|review|bun/docs/runtime,anthropic-docs|REVIEW SESSION: This session was already implemented. The code exists and 298 tests pass. Your job is to REVIEW and UPGRADE the existing implementation using the reference documentation.

REFERENCE DOCS AVAILABLE:
- docs/references/bun/docs/runtime/ — Bun runtime APIs (especially Bun.spawn, child_process, file I/O)
- docs/references/anthropic-docs/tools-overview.md — Tool definition format
- docs/references/anthropic-docs/implement-tool-use.md — Tool use implementation
- docs/references/anthropic-docs/programatic-tool-calling.md — Programmatic tool calling

WHAT TO DO:
1. Read the frozen spec and progress tracker
2. Read the EXISTING source files (src/tools/bash.ts, src/tools/engine.ts, src/tools/definitions.ts, src/tools/files.ts, src/tools/ssh.ts, src/tools/cron.ts)
3. Read the Bun spawn/child_process docs — are we using the best APIs for PTY allocation?
4. Read the tool use docs — do our tool definitions match the exact API format?
5. Check Bun file I/O APIs — any better methods than what we're using?
6. Fix, upgrade, or enhance based on what the docs reveal
7. Run ALL tests: bun test — ensure nothing breaks
8. Update the progress tracker session log

The PTY bash is THE foundational capability. Make sure Bun.spawn is used optimally per the docs."

    "E|Daemon Core & Session Management|review|bun/docs/runtime,anthropic-docs|REVIEW SESSION: This session was already implemented. The code exists and 298 tests pass. Your job is to REVIEW and UPGRADE the existing implementation using the reference documentation.

REFERENCE DOCS AVAILABLE:
- docs/references/bun/docs/runtime/ — Bun runtime APIs (process signals, timers, async patterns)
- docs/references/anthropic-docs/streaming-messages.md — Streaming protocol details
- docs/references/anthropic-docs/handling-stop-reasons.md — Stop reason handling
- docs/references/anthropic-docs/errors.md — Error handling and retry patterns

WHAT TO DO:
1. Read the frozen spec and progress tracker
2. Read the EXISTING source files (src/daemon.ts, src/conversation.ts, src/session/manager.ts, src/session/transcript.ts)
3. Read Bun runtime docs for signal handling, timer APIs, async patterns
4. Read streaming/stop-reason docs — verify conversation loop handles all cases correctly
5. Check error retry logic against documented error codes
6. Fix, upgrade, or enhance based on what the docs reveal
7. Run ALL tests: bun test — ensure nothing breaks
8. Update the progress tracker session log"

    "F|Post-Interaction Curators|review|anthropic-docs|REVIEW SESSION: This session was already implemented. The code exists and 298 tests pass. Your job is to REVIEW and UPGRADE the existing implementation using the reference documentation.

REFERENCE DOCS AVAILABLE:
- docs/references/anthropic-docs/create-message.md — Messages API for curator calls
- docs/references/anthropic-docs/models.md — Model names/IDs for Sonnet and Haiku curators
- docs/references/anthropic-docs/caching.md — Cache behavior (curators should benefit from caching too)
- docs/references/anthropic-docs/token-counting.md — Budget awareness for curator prompts

WHAT TO DO:
1. Read the frozen spec and progress tracker
2. Read the EXISTING source files (src/curators/orchestrator.ts, src/curators/tier2.ts, src/curators/tier3.ts, src/curators/archive.ts, src/curators/prompts.ts)
3. Verify model IDs match current Claude model names in docs/references/anthropic-docs/models.md
4. Check if curator API calls could benefit from caching
5. Verify prompt formatting follows API best practices from the docs
6. Fix, upgrade, or enhance based on what the docs reveal
7. Run ALL tests: bun test — ensure nothing breaks
8. Update the progress tracker session log"

    "G|Heartbeat & Self-Scheduling|build|bun/docs/runtime,anthropic-docs|BUILD SESSION: This is a NEW session. Build from scratch following the spec.

REFERENCE DOCS AVAILABLE — USE THEM:
- docs/references/bun/docs/runtime/ — Bun runtime APIs (timers, process, child_process for cron)
- docs/references/anthropic-docs/models.md — Model capabilities for rate limit decisions
- docs/references/anthropic-docs/errors.md — Rate limit error codes (429)

Read the relevant reference docs BEFORE writing code. The docs contain the exact APIs and patterns you need. Do not rely solely on training data — the docs may have newer or different APIs than what you expect.

SESSION CONTEXT: This session gives Jarvis its own heartbeat. Self-modifiable crontab with tagged entries. Wake mechanism: cron fires daemon wake command. Rate limit tracking via /api/oauth/usage endpoint. Built-in tasks: morning_routine, check_rate_limits, weekly_review. Model downgrade when near limits. See spec: Component 5 (The Heartbeat)."

    "H|CLI Interface & Polish|build|bun/docs/runtime|BUILD SESSION: This is a NEW session. Build from scratch following the spec.

REFERENCE DOCS AVAILABLE — USE THEM:
- docs/references/bun/docs/runtime/ — Bun runtime APIs (process.stdin, readline, TTY, signals, Bun.argv)
- docs/references/bun/docs/project/ — Entry point config (package.json bin field)

Read the relevant reference docs BEFORE writing code. The docs contain the exact APIs and patterns you need. Do not rely solely on training data — the docs may have newer or different APIs than what you expect.

SESSION CONTEXT: This session builds the interactive CLI and polishes end-to-end. Readline input loop, streaming output, context stats on startup. Commands: /quit, /status, /session, /tiers. Entry points: jarvis (interactive), jarvis wake --task, jarvis status. Wire the full loop: CLI -> Daemon -> Context -> API -> Tools -> Response -> CLI."

    "I|Messaging Integration (Telegram)|build|telegram-bot-api.md|BUILD SESSION: This is a NEW session. Build from scratch following the spec.

REFERENCE DOCS AVAILABLE — USE THEM:
- docs/references/telegram-bot-api.md — COMPLETE Telegram Bot API documentation (392K, everything you need)
- docs/references/bun/docs/runtime/ — Bun runtime APIs (fetch for HTTP, timers for polling)

Read docs/references/telegram-bot-api.md BEFORE writing code. This is a 392K comprehensive reference with every endpoint, parameter, and type. Do NOT guess Telegram API endpoints or parameters — look them up in this file.

SESSION CONTEXT: This session adds Telegram as the primary remote channel. Bot token from config, message handler routes to daemon, response accumulated and sent. Security: only respond to allowed chat IDs. Handle Telegram 4096 char limit with message splitting. Commands: /status, /session, /tiers. Reconnection on failure."
)

# === Functions ===
build_prompt() {
    local letter="$1"
    local title="$2"
    local mode="$3"
    local refs="$4"
    local custom_context="$5"

    if [ "$mode" = "review" ]; then
        cat <<PROMPT
You are reviewing and upgrading Session $letter ($title) of the Jarvis project.

This session was ALREADY BUILT. All tests pass. Your job is to review the existing code against the reference documentation and make targeted improvements.

$custom_context

Quality gates: zero warnings, zero dead code, all existing tests must still pass plus any new ones you add. Surgical improvements, not rewrites.

IMPORTANT: This is Jarvis - a personal AI vessel. The code should be clean, minimal, and self-documenting. Only 1-2 production dependencies. TypeScript/Bun. No frameworks, no over-engineering.
PROMPT
    else
        cat <<PROMPT
You are executing Session $letter ($title) of the Jarvis project using the Brick-by-Brick methodology.

BEFORE WRITING ANY CODE:
1. Read the frozen spec: $SPEC_FILE
2. Read the progress tracker: $PROGRESS_FILE
3. Find Session $letter in the progress tracker
4. Mark it as IN PROGRESS
5. Read the reference documentation listed below

$custom_context

THEN:
- Work through every checkbox in Session $letter
- Write tests alongside implementation (not after)
- Run tests frequently with: bun test
- Check each box as you complete it

WHEN DONE:
- Verify ALL tests pass (existing + new) with: bun test
- Verify zero TypeScript errors with: bun run check (if configured)
- Update test counts in the progress tracker
- Write the session log entry
- Mark Session $letter as COMPLETE

Quality gates: zero warnings, zero dead code, zero shortcuts. One brick at a time.

IMPORTANT: This is Jarvis - a personal AI vessel. The code should be clean, minimal, and self-documenting. Only 1-2 production dependencies. TypeScript/Bun. No frameworks, no over-engineering.
PROMPT
    fi
}

run_session() {
    local letter="$1"
    local title="$2"
    local mode="$3"
    local refs="$4"
    local custom_context="$5"

    local mode_label="BUILD"
    [ "$mode" = "review" ] && mode_label="REVIEW"

    echo ""
    echo "============================================"
    echo "  SESSION $letter [$mode_label]: $title"
    echo "============================================"
    echo ""

    mkdir -p "$LOG_DIR"
    local log_file="$LOG_DIR/session_${letter}_${mode}_$(date +%Y%m%d_%H%M%S).log"

    local prompt
    prompt=$(build_prompt "$letter" "$title" "$mode" "$refs" "$custom_context")

    # Launch Claude Code with the session prompt
    cd "$PROJECT_DIR"
    echo "$prompt" | claude --dangerously-skip-permissions 2>&1 | tee "$log_file"

    local exit_code=${PIPESTATUS[1]:-0}

    if [ "$exit_code" -ne 0 ]; then
        echo ""
        echo "WARNING: Session $letter exited with code $exit_code"
        echo "Check log: $log_file"
        echo "Continue to next session? (y/n)"
        read -r response
        if [ "$response" != "y" ]; then
            echo "Stopping automation."
            exit 1
        fi
    fi

    echo ""
    echo "Session $letter [$mode_label] complete. Log saved to: $log_file"
}

wait_for_memory_sync() {
    echo ""
    echo "Waiting ${MEMORY_SYNC_SECONDS}s for memory system sync..."
    sleep "$MEMORY_SYNC_SECONDS"
    echo "Memory sync complete."
}

# === Main ===
start_from="${1:-A}"
started=false

echo "========================================"
echo "  JARVIS - BRICK-BY-BRICK AUTOMATION"
echo "  Project: $PROJECT_DIR"
echo "  Starting from: Session $start_from"
echo "  Reference docs: $REFS_DIR"
echo "========================================"

for session_entry in "${SESSIONS[@]}"; do
    IFS='|' read -r letter title mode refs custom_context <<< "$session_entry"

    # Skip sessions before start_from
    if [ "$started" = false ]; then
        if [ "$letter" = "$start_from" ]; then
            started=true
        else
            continue
        fi
    fi

    run_session "$letter" "$title" "$mode" "$refs" "$custom_context"

    # Pause between sessions (skip after last)
    wait_for_memory_sync
done

echo ""
echo "========================================"
echo "  ALL SESSIONS COMPLETE"
echo "  The vessel is ready."
echo "========================================"

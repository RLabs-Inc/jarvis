// ---------------------------------------------------------------------------
// The Daemon
// ---------------------------------------------------------------------------
//
// The always-on process that is the vessel's heartbeat.
//
// Responsibilities:
// 1. Listen for incoming messages (from CLI, Telegram, webhooks)
// 2. Assemble tiered context before each API call
// 3. Run the multi-turn conversation loop
// 4. Manage session lifecycle
// 5. Trigger post-interaction curation when a session ends
// 6. Graceful shutdown on SIGINT/SIGTERM
//
// The daemon is the orchestrator — it connects context assembly,
// API client, tool engine, session management, and conversation loop
// into a single cohesive process.
// ---------------------------------------------------------------------------

import type { JarvisConfig } from "./config.ts";
import type { Message } from "./api/types.ts";
import { ClaudeClient } from "./api/client.ts";
import { assembleContext } from "./context/assembler.ts";
import { CORE_TOOLS } from "./tools/definitions.ts";
import { SessionManager } from "./session/manager.ts";
import type { SessionEndEvent } from "./session/manager.ts";
import { runConversation } from "./conversation.ts";
import type { ConversationEvent, PendingMessagesDrain } from "./conversation.ts";
import { triggerCuration } from "./curators/orchestrator.ts";
import type { CurationResult } from "./curators/orchestrator.ts";
import { handleWake } from "./heartbeat/wake.ts";
import type { WakeResult } from "./heartbeat/wake.ts";
import { createTelegramBot } from "./senses/telegram.ts";
import type { TelegramBot } from "./senses/telegram.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DaemonStatus = "idle" | "running" | "shutdown";

export interface DaemonStats {
  status: DaemonStatus;
  sessionId: string | null;
  messageCount: number;
  uptime: number;
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

export class Daemon {
  private status: DaemonStatus = "idle";
  private readonly client: ClaudeClient;
  private readonly sessions: SessionManager;
  private readonly startTime: number;
  private shutdownHandlers: (() => void)[] = [];
  private telegramBot: TelegramBot | null = null;

  /** Callback fired when a session ends (for external observers). */
  onSessionEnd: ((event: SessionEndEvent) => void) | null = null;

  /** Callback fired when curation completes. */
  onCurationComplete: ((result: CurationResult) => void) | null = null;

  constructor(private readonly config: JarvisConfig) {
    this.client = new ClaudeClient(config);
    this.startTime = Date.now();

    this.sessions = new SessionManager(
      config.mindDir,
      config.sessionTimeoutMs,
      (event) => this.handleSessionEnd(event),
    );
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the daemon. Sets up signal handlers and marks as running.
   */
  start(): void {
    if (this.status === "running") return;
    this.status = "running";
    this.installSignalHandlers();
  }

  /**
   * Gracefully shut down the daemon. Ends active session, cleans up.
   */
  shutdown(): SessionEndEvent | null {
    if (this.status === "shutdown") return null;

    this.stopTelegram();
    const endEvent = this.sessions.endSession("shutdown");
    this.sessions.destroy();
    this.removeSignalHandlers();
    this.status = "shutdown";

    return endEvent;
  }

  /**
   * Start the Telegram bot if configured. No-op if token not set.
   */
  startTelegram(): void {
    if (this.telegramBot?.isRunning()) return;
    this.telegramBot = createTelegramBot(this, this.config);
    this.telegramBot?.start();
  }

  /**
   * Stop the Telegram bot if running.
   */
  stopTelegram(): void {
    this.telegramBot?.stop();
    this.telegramBot = null;
  }

  /**
   * Get the Telegram bot instance (for external inspection/testing).
   */
  getTelegramBot(): TelegramBot | null {
    return this.telegramBot;
  }

  /**
   * Get the current daemon stats.
   */
  getStats(): DaemonStats {
    const session = this.sessions.getActiveSession();
    return {
      status: this.status,
      sessionId: session?.id ?? null,
      messageCount: session?.messageCount ?? 0,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Get the session manager (for external inspection).
   */
  getSessionManager(): SessionManager {
    return this.sessions;
  }

  // -----------------------------------------------------------------------
  // Message Handling
  // -----------------------------------------------------------------------

  /**
   * Process a user message through the full pipeline:
   *   context assembly → conversation loop → yield events
   *
   * Automatically starts a session if none is active.
   * Yields ConversationEvents for real-time display.
   *
   * @param text - The user's message text
   * @param pendingMessages - Optional callback to drain queued messages.
   *   When provided, the conversation loop will inject queued messages
   *   alongside tool results and after turn completion.
   */
  async *handleMessage(
    text: string,
    pendingMessages?: PendingMessagesDrain,
  ): AsyncGenerator<ConversationEvent> {
    if (this.status === "shutdown") {
      yield {
        type: "error",
        error: new Error("Daemon is shut down"),
        recoverable: false,
      };
      return;
    }

    // Ensure daemon is running
    if (this.status === "idle") {
      this.start();
    }

    // Ensure a session is active
    if (!this.sessions.getActiveSession()) {
      this.sessions.startSession();
    }

    // Record the user message
    const userMessage: Message = { role: "user", content: text };
    this.sessions.addMessage(userMessage);

    // Load full conversation history from transcript
    const history = this.sessions.getMessages();

    // Assemble tiered context
    let system;
    let messages;
    try {
      const context = await assembleContext(this.config, history);
      system = context.system;
      messages = context.messages;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: "error", error, recoverable: false };
      return;
    }

    // Snapshot length BEFORE the conversation loop mutates the array.
    // assembleContext may truncate messages (tier4 budget), so messages.length
    // can be shorter than history.length. We need the pre-loop length of the
    // actual array the conversation loop will append to.
    const preLoopLength = messages.length;

    // Run conversation loop
    const events = runConversation(this.client, {
      system,
      tools: CORE_TOOLS,
      messages,
      pendingMessages,
    });

    for await (const event of events) {
      yield event;

      // After the loop modifies messages, we need to persist new ones
      if (event.type === "turn_complete" || event.type === "error") {
        // Persist any new messages that were added during the conversation
        this.persistNewMessages(preLoopLength, messages);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Session Control
  // -----------------------------------------------------------------------

  /**
   * Start a new session explicitly. Returns the session info.
   */
  startSession() {
    return this.sessions.startSession();
  }

  /**
   * End the current session explicitly.
   */
  endSession(reason: "user_quit" | "shutdown" = "user_quit") {
    return this.sessions.endSession(reason);
  }

  // -----------------------------------------------------------------------
  // Heartbeat — Autonomous Tasks
  // -----------------------------------------------------------------------

  /**
   * Execute an autonomous task triggered by cron.
   * This is a one-shot execution — does not use the session manager.
   * Called via: jarvis wake --task <name>
   */
  async wake(taskName: string): Promise<WakeResult> {
    return handleWake(taskName, this.config);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Persist messages that were added during the conversation loop.
   * The conversation loop mutates the messages array — we need to record
   * any new assistant and tool_result messages to the transcript.
   *
   * Uses the pre-loop array length (not the transcript length) because
   * assembleContext may truncate the messages array for tier4 budget,
   * making it shorter than the full transcript.
   */
  private persistNewMessages(preLoopLength: number, updatedMessages: Message[]): void {
    for (let i = preLoopLength; i < updatedMessages.length; i++) {
      const msg = updatedMessages[i];
      if (msg) {
        this.sessions.addMessage(msg);
      }
    }
  }

  private handleSessionEnd(event: SessionEndEvent): void {
    // Notify external observers
    this.onSessionEnd?.(event);

    // Fire-and-forget: run the sleep consolidation cycle
    triggerCuration(
      this.config,
      event,
      (result) => this.onCurationComplete?.(result),
    );
  }

  // -----------------------------------------------------------------------
  // Signal Handlers
  // -----------------------------------------------------------------------

  private installSignalHandlers(): void {
    const handler = () => {
      this.shutdown();
    };

    // Store references for cleanup
    this.shutdownHandlers = [handler];

    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  }

  private removeSignalHandlers(): void {
    for (const handler of this.shutdownHandlers) {
      process.removeListener("SIGINT", handler);
      process.removeListener("SIGTERM", handler);
    }
    this.shutdownHandlers = [];
  }
}

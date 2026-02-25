// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------
//
// Manages the lifecycle of interaction sessions. Each interaction with the
// user is a session with a unique ID, start time, and status.
//
// Sessions end when:
// - The user explicitly ends (goodbye, /quit)
// - Idle timeout fires (configurable, default 30 minutes)
// - Programmatic end (daemon shutdown)
//
// When a session ends, the transcript is archived and a curation event fires.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { appendMessage, loadTranscript, archiveSession as archiveTranscript } from "./transcript.ts";
import type { Message } from "../api/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = "active" | "ended";

export interface Session {
  id: string;
  startTime: string;
  status: SessionStatus;
  messageCount: number;
}

export type SessionEndReason = "user_quit" | "idle_timeout" | "shutdown" | "new_session";

export interface SessionEndEvent {
  sessionId: string;
  reason: SessionEndReason;
  messageCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export class SessionManager {
  private currentSession: Session | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onSessionEnd: ((event: SessionEndEvent) => void) | null;

  constructor(
    private readonly mindDir: string,
    private readonly idleTimeoutMs: number,
    onSessionEnd?: (event: SessionEndEvent) => void,
  ) {
    this.onSessionEnd = onSessionEnd ?? null;
  }

  /**
   * Start a new session. If one is already active, ends it first.
   */
  startSession(): Session {
    if (this.currentSession?.status === "active") {
      this.endSession("new_session");
    }

    const session: Session = {
      id: randomUUID(),
      startTime: new Date().toISOString(),
      status: "active",
      messageCount: 0,
    };

    this.currentSession = session;
    this.resetIdleTimer();
    return session;
  }

  /**
   * End the current session. Archives the transcript and fires the end event.
   * Returns the end event, or null if no session was active.
   */
  endSession(reason: SessionEndReason): SessionEndEvent | null {
    if (!this.currentSession || this.currentSession.status !== "active") {
      return null;
    }

    this.clearIdleTimer();

    const session = this.currentSession;
    session.status = "ended";

    const startMs = new Date(session.startTime).getTime();
    const durationMs = Date.now() - startMs;

    // Archive the transcript
    archiveTranscript(this.mindDir, session.id);

    const event: SessionEndEvent = {
      sessionId: session.id,
      reason,
      messageCount: session.messageCount,
      durationMs,
    };

    // Fire the end event (for curators)
    this.onSessionEnd?.(event);

    return event;
  }

  /**
   * Get the current active session, or null if none.
   */
  getActiveSession(): Session | null {
    if (this.currentSession?.status === "active") {
      return this.currentSession;
    }
    return null;
  }

  /**
   * Record a message in the current session's transcript.
   * Resets the idle timer on each message.
   */
  addMessage(message: Message): void {
    if (!this.currentSession || this.currentSession.status !== "active") {
      throw new Error("No active session — call startSession() first");
    }

    appendMessage(this.mindDir, this.currentSession.id, message);
    this.currentSession.messageCount++;
    this.resetIdleTimer();
  }

  /**
   * Load all messages from the current session's transcript.
   */
  getMessages(): Message[] {
    if (!this.currentSession) return [];
    return loadTranscript(this.mindDir, this.currentSession.id);
  }

  /**
   * Get the session's duration so far in milliseconds.
   */
  getSessionDurationMs(): number {
    if (!this.currentSession) return 0;
    const startMs = new Date(this.currentSession.startTime).getTime();
    return Date.now() - startMs;
  }

  /**
   * Clean up resources (timers). Call on daemon shutdown.
   */
  destroy(): void {
    this.clearIdleTimer();
  }

  // -------------------------------------------------------------------------
  // Idle Timer
  // -------------------------------------------------------------------------

  private resetIdleTimer(): void {
    this.clearIdleTimer();

    if (this.idleTimeoutMs <= 0) return;

    this.idleTimer = setTimeout(() => {
      if (this.currentSession?.status === "active") {
        this.endSession("idle_timeout");
      }
    }, this.idleTimeoutMs);

    // Don't block process exit
    if (this.idleTimer && typeof this.idleTimer === "object" && "unref" in this.idleTimer) {
      this.idleTimer.unref();
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

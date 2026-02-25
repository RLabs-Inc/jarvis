// ---------------------------------------------------------------------------
// Conversation Loop
// ---------------------------------------------------------------------------
//
// The multi-turn conversation loop that processes a user message:
//
//   message → context assembly → API call → response
//     ↳ if tool_use → execute tools → feed results → API call → ...
//     ↳ if max_tokens → auto-continue with prompt
//     ↳ if text → yield to caller
//     ↳ if end_turn → done
//
// Yields ConversationEvents so the caller can:
// - Display text deltas to the user in real time
// - Show which tools are being called
// - Track usage and caching stats
//
// The loop handles the recursive tool call pattern: Claude may request
// multiple rounds of tool calls before producing a final text response.
//
// Message Queue Integration:
//   When a pendingMessages callback is provided, the loop checks for queued
//   messages at two points:
//   1. After tool results — queued messages are injected as text blocks in
//      the same user message alongside tool_result blocks, so Claude sees
//      them in context with the tool outputs.
//   2. After turn_complete — if messages arrived during the final response,
//      they're appended as a new user message and the loop continues.
// ---------------------------------------------------------------------------

import type { Message, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, SystemBlock, ToolDefinition } from "./api/types.ts";
import { ClaudeApiError } from "./api/types.ts";
import type { AccumulatedResponse } from "./api/streaming.ts";
import { ClaudeClient } from "./api/client.ts";
import { executeToolForApi } from "./tools/engine.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextDeltaEvent {
  type: "text_delta";
  text: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolId: string;
  content: string;
  isError: boolean;
}

export interface TurnCompleteEvent {
  type: "turn_complete";
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

export interface ErrorEvent {
  type: "error";
  error: Error;
  recoverable: boolean;
}

/** Emitted when queued messages are injected into the conversation. */
export interface QueuedMessagesEvent {
  type: "queued_messages";
  messages: string[];
}

export type ConversationEvent =
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnCompleteEvent
  | QueuedMessagesEvent
  | ErrorEvent;

/**
 * Callback that drains pending messages from the queue.
 * Returns an array of message texts and removes them from the queue.
 * Returns an empty array if no messages are pending.
 */
export type PendingMessagesDrain = () => string[];

export interface ConversationOptions {
  system: SystemBlock[];
  tools: ToolDefinition[];
  messages: Message[];
  maxTurns?: number;
  /** Optional callback to drain pending messages from the queue. */
  pendingMessages?: PendingMessagesDrain;
}

// ---------------------------------------------------------------------------
// Conversation Loop
// ---------------------------------------------------------------------------

/** Default max turns to prevent runaway tool loops. */
const DEFAULT_MAX_TURNS = 100;

/**
 * Run a multi-turn conversation loop.
 *
 * Yields events as they happen — text deltas for real-time display,
 * tool call/result notifications, and a final turn_complete event.
 *
 * The messages array is mutated in place: assistant responses and tool
 * results are appended to build the conversation history. The caller
 * is responsible for persisting these messages to the transcript.
 *
 * When pendingMessages is provided, queued messages are injected:
 * - With tool results: as text blocks in the same user message
 * - After turn_complete: as a new user message to continue the conversation
 */
export async function* runConversation(
  client: ClaudeClient,
  options: ConversationOptions,
): AsyncGenerator<ConversationEvent> {
  const { system, tools, messages, maxTurns = DEFAULT_MAX_TURNS, pendingMessages } = options;
  let turnsRemaining = maxTurns;

  while (turnsRemaining > 0) {
    turnsRemaining--;

    // ---- Make the API call with streaming
    let response: AccumulatedResponse;
    try {
      const textDeltas: string[] = [];

      response = await client.streamAndAccumulate(
        { system, tools, messages },
        (delta) => {
          textDeltas.push(delta);
        },
      );

      // Yield text deltas after accumulation
      // (collected during streaming, replayed here for the generator)
      for (const delta of textDeltas) {
        yield { type: "text_delta", text: delta };
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: "error", error, recoverable: isRecoverableError(error) };
      return;
    }

    // ---- Add assistant response to conversation history
    const assistantMessage: Message = {
      role: "assistant",
      content: response.content,
    };
    messages.push(assistantMessage);

    // ---- Check stop reason
    const stopReason = response.stopReason ?? "end_turn";

    if (stopReason === "tool_use") {
      // Extract tool calls from the response
      const toolCalls = response.content.filter(
        (block): block is ToolUseBlock => block.type === "tool_use",
      );

      if (toolCalls.length === 0) {
        // Shouldn't happen, but handle gracefully
        yield makeTurnComplete(stopReason, response);
        return;
      }

      // Execute all tool calls
      const toolResults: ToolResultBlock[] = [];

      for (const toolCall of toolCalls) {
        yield {
          type: "tool_call",
          toolName: toolCall.name,
          toolId: toolCall.id,
          input: toolCall.input,
        };

        const result = await executeToolForApi(toolCall);
        toolResults.push(result);

        yield {
          type: "tool_result",
          toolId: toolCall.id,
          content: result.content,
          isError: result.is_error ?? false,
        };
      }

      // Build the user message with tool results
      const contentBlocks: ContentBlock[] = [...toolResults];

      // Check for queued messages and inject them alongside tool results
      const queued = pendingMessages?.() ?? [];
      if (queued.length > 0) {
        for (const text of queued) {
          contentBlocks.push({ type: "text", text } as TextBlock);
        }
        yield { type: "queued_messages", messages: queued };
      }

      // Add tool results (+ any queued messages) as a user message
      const toolResultMessage: Message = {
        role: "user",
        content: contentBlocks,
      };
      messages.push(toolResultMessage);

      // Loop back for another API call
      continue;
    }

    if (stopReason === "pause_turn") {
      // Per Anthropic API docs: pause_turn is returned when server-side tools
      // (web search, code execution) hit their iteration limit. Continue the
      // conversation by looping back — the assistant message was already pushed
      // above, so the next API call picks up where it left off.
      continue;
    }

    if (stopReason === "max_tokens") {
      // Response was truncated because it hit the max_tokens limit.
      // Automatically continue by prompting Claude to pick up where it left off.
      const continueMessage: Message = {
        role: "user",
        content: "Continue from where you left off.",
      };
      messages.push(continueMessage);
      continue;
    }

    // ---- end_turn, stop_sequence, refusal, etc. → we're done
    yield makeTurnComplete(stopReason, response);

    // Check for queued messages that arrived during the final response.
    // If any exist, inject them as a new user message and continue the loop
    // so Claude can respond to them.
    const finalQueued = pendingMessages?.() ?? [];
    if (finalQueued.length > 0) {
      const combinedText = finalQueued.join("\n\n");
      const queuedMessage: Message = {
        role: "user",
        content: combinedText,
      };
      messages.push(queuedMessage);
      yield { type: "queued_messages", messages: finalQueued };
      // Continue the loop — Claude needs to respond to the new messages
      continue;
    }

    return;
  }

  // Max turns exceeded
  yield {
    type: "error",
    error: new Error(`Conversation exceeded maximum turns (${maxTurns})`),
    recoverable: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTurnComplete(stopReason: string, response: AccumulatedResponse): TurnCompleteEvent {
  return {
    type: "turn_complete",
    stopReason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

/**
 * Determine if an error is recoverable (worth retrying).
 * Per Anthropic API docs: 429 (rate limit) and 529 (overloaded) are transient.
 * Uses typed ClaudeApiError properties when available; falls back to string
 * matching for generic errors (network issues, timeouts).
 */
function isRecoverableError(error: Error): boolean {
  if (error instanceof ClaudeApiError) {
    return error.isRateLimit || error.isOverloaded || error.isServerError;
  }
  // Fallback for non-API errors (network timeouts, etc.)
  const msg = error.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("network") || msg.includes("econnreset");
}

// ---------------------------------------------------------------------------
// Utility: Collect full text response from conversation events
// ---------------------------------------------------------------------------

/**
 * Collect all text deltas from a conversation into a single string.
 * Useful for non-streaming callers who just want the final text.
 */
export async function collectText(events: AsyncGenerator<ConversationEvent>): Promise<string> {
  let text = "";
  for await (const event of events) {
    if (event.type === "text_delta") {
      text += event.text;
    }
  }
  return text;
}

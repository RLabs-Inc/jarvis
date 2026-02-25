// ---------------------------------------------------------------------------
// SSE Stream Handler
// ---------------------------------------------------------------------------
//
// Parses the Claude API's Server-Sent Events stream into typed events.
// Uses eventsource-parser for SSE framing, then JSON-parses each event's
// data field into our typed StreamEvent union.
//
// Yields events as an async generator — the consumer pulls at their pace.
// Accumulates the final ClaudeResponse from stream events for convenience.
// ---------------------------------------------------------------------------

import { createParser } from "eventsource-parser";
import type {
  StreamEvent,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  StopReason,
  Usage,
} from "./types.ts";

/**
 * Parse an SSE response body into typed stream events.
 * Yields each event as it arrives.
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  const queue: StreamEvent[] = [];

  const parser = createParser({
    onEvent(event) {
      if (event.data === "[DONE]") return;

      try {
        queue.push(JSON.parse(event.data) as StreamEvent);
      } catch {
        // Malformed JSON — skip this event
      }
    },
  });

  const reader = body.getReader();

  try {
    while (true) {
      const { value, done: readerDone } = await reader.read();

      if (readerDone) break;

      parser.feed(decoder.decode(value, { stream: true }));

      // Yield all queued events
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    }

    // Yield any remaining events after stream closes
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Stream Accumulator
// ---------------------------------------------------------------------------

/** Accumulated state from a streaming response. */
export interface AccumulatedResponse {
  id: string;
  model: string;
  content: ContentBlock[];
  stopReason: StopReason | null;
  stopSequence: string | null;
  usage: Usage;
}

/**
 * Accumulate a complete response from stream events.
 * Also invokes an optional callback on each text delta for real-time output.
 */
export async function accumulateStream(
  events: AsyncGenerator<StreamEvent>,
  onTextDelta?: (text: string) => void,
): Promise<AccumulatedResponse> {
  const result: AccumulatedResponse = {
    id: "",
    model: "",
    content: [],
    stopReason: null,
    stopSequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };

  // Track content blocks being built
  const blocks: Map<number, { type: string; text: string; id?: string; name?: string; inputJson?: string }> = new Map();

  for await (const event of events) {
    switch (event.type) {
      case "message_start": {
        result.id = event.message.id;
        result.model = event.message.model;
        result.usage = { ...event.message.usage };
        break;
      }

      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "text") {
          blocks.set(event.index, { type: "text", text: "" });
        } else if (block.type === "tool_use") {
          blocks.set(event.index, {
            type: "tool_use",
            text: "",
            id: block.id,
            name: block.name,
            inputJson: "",
          });
        }
        break;
      }

      case "content_block_delta": {
        const existing = blocks.get(event.index);
        if (!existing) break;

        if (event.delta.type === "text_delta") {
          existing.text += event.delta.text;
          onTextDelta?.(event.delta.text);
        } else if (event.delta.type === "input_json_delta") {
          existing.inputJson = (existing.inputJson ?? "") + event.delta.partial_json;
        }
        break;
      }

      case "content_block_stop": {
        const finished = blocks.get(event.index);
        if (!finished) break;

        if (finished.type === "text") {
          result.content.push({ type: "text", text: finished.text } as TextBlock);
        } else if (finished.type === "tool_use") {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(finished.inputJson || "{}") as Record<string, unknown>;
          } catch {
            // Malformed tool input — use empty object
          }
          result.content.push({
            type: "tool_use",
            id: finished.id!,
            name: finished.name!,
            input,
          } as ToolUseBlock);
        }
        blocks.delete(event.index);
        break;
      }

      case "message_delta": {
        result.stopReason = event.delta.stop_reason;
        result.stopSequence = event.delta.stop_sequence ?? null;
        result.usage.output_tokens = event.usage.output_tokens;
        if (event.usage.cache_creation_input_tokens !== undefined) {
          result.usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        }
        if (event.usage.cache_read_input_tokens !== undefined) {
          result.usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        }
        break;
      }

      case "error": {
        throw new Error(`Stream error: ${event.error.type} - ${event.error.message}`);
      }

      // ping and message_stop are no-ops for accumulation
    }
  }

  return result;
}

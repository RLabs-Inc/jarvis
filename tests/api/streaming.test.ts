import { describe, expect, it } from "bun:test";
import { parseSSEStream, accumulateStream } from "../../src/api/streaming.ts";
import type { StreamEvent } from "../../src/api/types.ts";

// ---------------------------------------------------------------------------
// Helpers: create a ReadableStream from SSE text
// ---------------------------------------------------------------------------

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Format a single SSE event line. */
function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// A realistic stream: text response "Hello world"
// ---------------------------------------------------------------------------

function makeTextStream(): ReadableStream<Uint8Array> {
  return sseStream([
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: "msg_01",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-opus-4-6",
        stop_reason: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " world" },
    }),
    sseEvent("content_block_stop", {
      type: "content_block_stop",
      index: 0,
    }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ]);
}

// ---------------------------------------------------------------------------
// A realistic stream: tool use response
// ---------------------------------------------------------------------------

function makeToolStream(): ReadableStream<Uint8Array> {
  return sseStream([
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: "msg_02",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-opus-4-6",
        stop_reason: null,
        usage: { input_tokens: 200, output_tokens: 0 },
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_01", name: "bash", input: {} },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"comma' },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: 'nd":"ls -la"}' },
    }),
    sseEvent("content_block_stop", {
      type: "content_block_stop",
      index: 0,
    }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 20 },
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ]);
}

// ---------------------------------------------------------------------------
// parseSSEStream tests
// ---------------------------------------------------------------------------

describe("parseSSEStream", () => {
  it("parses text response events in order", async () => {
    const events: StreamEvent[] = [];
    for await (const event of parseSSEStream(makeTextStream())) {
      events.push(event);
    }

    expect(events.length).toBe(7);
    expect(events[0]!.type).toBe("message_start");
    expect(events[1]!.type).toBe("content_block_start");
    expect(events[2]!.type).toBe("content_block_delta");
    expect(events[3]!.type).toBe("content_block_delta");
    expect(events[4]!.type).toBe("content_block_stop");
    expect(events[5]!.type).toBe("message_delta");
    expect(events[6]!.type).toBe("message_stop");
  });

  it("parses tool use events", async () => {
    const events: StreamEvent[] = [];
    for await (const event of parseSSEStream(makeToolStream())) {
      events.push(event);
    }

    expect(events.length).toBe(7);
    expect(events[0]!.type).toBe("message_start");

    const blockStart = events[1]!;
    expect(blockStart.type).toBe("content_block_start");
    if (blockStart.type === "content_block_start") {
      expect(blockStart.content_block.type).toBe("tool_use");
    }
  });

  it("handles chunked SSE data (split across reads)", async () => {
    // SSE event split across two chunks
    const stream = sseStream([
      'event: ping\ndata: {"typ',
      'e":"ping"}\n\n',
    ]);

    const events: StreamEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("ping");
  });

  it("skips [DONE] marker", async () => {
    const stream = sseStream([
      sseEvent("ping", { type: "ping" }),
      "event: done\ndata: [DONE]\n\n",
    ]);

    const events: StreamEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("ping");
  });

  it("skips malformed JSON events", async () => {
    const stream = sseStream([
      sseEvent("ping", { type: "ping" }),
      "event: bad\ndata: {not valid json}\n\n",
      sseEvent("ping", { type: "ping" }),
    ]);

    const events: StreamEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    expect(events.length).toBe(2);
  });

  it("handles empty stream", async () => {
    const stream = sseStream([]);
    const events: StreamEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// accumulateStream tests
// ---------------------------------------------------------------------------

describe("accumulateStream", () => {
  it("accumulates text response into content blocks", async () => {
    const events = parseSSEStream(makeTextStream());
    const result = await accumulateStream(events);

    expect(result.id).toBe("msg_01");
    expect(result.model).toBe("claude-opus-4-6");
    expect(result.content.length).toBe(1);
    expect(result.content[0]!.type).toBe("text");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toBe("Hello world");
    }
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.input_tokens).toBe(100);
    expect(result.usage.output_tokens).toBe(5);
  });

  it("accumulates tool use with reconstructed JSON input", async () => {
    const events = parseSSEStream(makeToolStream());
    const result = await accumulateStream(events);

    expect(result.id).toBe("msg_02");
    expect(result.content.length).toBe(1);
    expect(result.content[0]!.type).toBe("tool_use");
    if (result.content[0]!.type === "tool_use") {
      expect(result.content[0]!.id).toBe("toolu_01");
      expect(result.content[0]!.name).toBe("bash");
      expect(result.content[0]!.input).toEqual({ command: "ls -la" });
    }
    expect(result.stopReason).toBe("tool_use");
  });

  it("invokes onTextDelta callback for each text chunk", async () => {
    const deltas: string[] = [];
    const events = parseSSEStream(makeTextStream());
    await accumulateStream(events, (text) => deltas.push(text));

    expect(deltas).toEqual(["Hello", " world"]);
  });

  it("handles stream error event", async () => {
    const stream = sseStream([
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_err",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-opus-4-6",
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      }),
      sseEvent("error", {
        type: "error",
        error: { type: "overloaded_error", message: "API is temporarily overloaded" },
      }),
    ]);

    const events = parseSSEStream(stream);
    await expect(accumulateStream(events)).rejects.toThrow("Stream error: overloaded_error");
  });

  it("handles mixed text and tool use blocks", async () => {
    const stream = sseStream([
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_03",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-opus-4-6",
          stop_reason: null,
          usage: { input_tokens: 50, output_tokens: 0 },
        },
      }),
      // Text block first
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me check." },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
      // Then tool use
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_02", name: "read_file", input: {} },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"path":"/etc/hosts"}' },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 30 },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ]);

    const events = parseSSEStream(stream);
    const result = await accumulateStream(events);

    expect(result.content.length).toBe(2);
    expect(result.content[0]!.type).toBe("text");
    expect(result.content[1]!.type).toBe("tool_use");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toBe("Let me check.");
    }
    if (result.content[1]!.type === "tool_use") {
      expect(result.content[1]!.name).toBe("read_file");
      expect(result.content[1]!.input).toEqual({ path: "/etc/hosts" });
    }
  });

  it("tracks cache usage from message_start", async () => {
    const stream = sseStream([
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_cache",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-opus-4-6",
          stop_reason: null,
          usage: {
            input_tokens: 50,
            output_tokens: 0,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 5000,
          },
        },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ]);

    const events = parseSSEStream(stream);
    const result = await accumulateStream(events);

    expect(result.usage.cache_creation_input_tokens).toBe(1000);
    expect(result.usage.cache_read_input_tokens).toBe(5000);
  });

  it("propagates stop_sequence from message_delta", async () => {
    const stream = sseStream([
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_seq",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-opus-4-6",
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "stop_sequence", stop_sequence: "\n\nHuman:" },
        usage: { output_tokens: 3 },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ]);

    const events = parseSSEStream(stream);
    const result = await accumulateStream(events);

    expect(result.stopReason).toBe("stop_sequence");
    expect(result.stopSequence).toBe("\n\nHuman:");
  });

  it("stopSequence defaults to null when not provided", async () => {
    const events = parseSSEStream(makeTextStream());
    const result = await accumulateStream(events);

    expect(result.stopSequence).toBeNull();
  });

  it("propagates cache usage from message_delta", async () => {
    const stream = sseStream([
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_delta_cache",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-opus-4-6",
          stop_reason: null,
          usage: { input_tokens: 50, output_tokens: 0 },
        },
      }),
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          output_tokens: 10,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 8000,
        },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ]);

    const events = parseSSEStream(stream);
    const result = await accumulateStream(events);

    expect(result.usage.output_tokens).toBe(10);
    expect(result.usage.cache_creation_input_tokens).toBe(2000);
    expect(result.usage.cache_read_input_tokens).toBe(8000);
  });
});

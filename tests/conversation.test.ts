import { describe, test, expect } from "bun:test";
import { runConversation, collectText } from "../src/conversation.ts";
import type { ConversationEvent } from "../src/conversation.ts";
import type { Message, SystemBlock, ContentBlock, ToolResultBlock, StopReason } from "../src/api/types.ts";
import { ClaudeApiError } from "../src/api/types.ts";
import type { AccumulatedResponse } from "../src/api/streaming.ts";
import { CORE_TOOLS } from "../src/tools/definitions.ts";

// ---------------------------------------------------------------------------
// Mock ClaudeClient
// ---------------------------------------------------------------------------

type ResponseFactory = (messages: Message[]) => AccumulatedResponse;

/**
 * Create a mock ClaudeClient that returns canned responses.
 * The responseFactory receives the message array and returns the response.
 */
function mockClient(responseFactory: ResponseFactory | AccumulatedResponse[]): MockClaudeClient {
  return new MockClaudeClient(responseFactory);
}

class MockClaudeClient {
  callCount = 0;
  private readonly factory: ResponseFactory;

  constructor(factoryOrResponses: ResponseFactory | AccumulatedResponse[]) {
    if (Array.isArray(factoryOrResponses)) {
      const responses = factoryOrResponses;
      this.factory = () => {
        const resp = responses[this.callCount - 1]; // callCount is incremented before factory call
        if (!resp) throw new Error(`Mock: no response for call ${this.callCount}`);
        return resp;
      };
    } else {
      this.factory = factoryOrResponses;
    }
  }

  async streamAndAccumulate(
    _options: { system?: SystemBlock[]; tools?: unknown[]; messages: Message[] },
    onTextDelta?: (text: string) => void,
  ): Promise<AccumulatedResponse> {
    this.callCount++;
    const response = this.factory(_options.messages);

    // Simulate text deltas for text content blocks
    for (const block of response.content) {
      if (block.type === "text") {
        onTextDelta?.(block.text);
      }
    }

    return response;
  }
}

// ---------------------------------------------------------------------------
// Response Builders
// ---------------------------------------------------------------------------

function textResponse(text: string, stopReason: StopReason = "end_turn"): AccumulatedResponse {
  return {
    id: `msg_${Date.now()}`,
    model: "claude-opus-4-6",
    content: [{ type: "text", text }],
    stopReason,
    stopSequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function toolUseResponse(
  tools: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  text?: string,
): AccumulatedResponse {
  const content: ContentBlock[] = [];
  if (text) {
    content.push({ type: "text", text });
  }
  for (const t of tools) {
    content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
  }
  return {
    id: `msg_${Date.now()}`,
    model: "claude-opus-4-6",
    content,
    stopReason: "tool_use",
    stopSequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// ---------------------------------------------------------------------------
// Helper to collect all events
// ---------------------------------------------------------------------------

async function collectEvents(gen: AsyncGenerator<ConversationEvent>): Promise<ConversationEvent[]> {
  const events: ConversationEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Simple Text Response
// ---------------------------------------------------------------------------

describe("conversation: simple text response", () => {
  test("yields text deltas and turn_complete", async () => {
    const client = mockClient([textResponse("Hello Sherlock!")]);
    const messages: Message[] = [{ role: "user", content: "Hi Watson" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBe(1);
    expect((textDeltas[0] as { text: string }).text).toBe("Hello Sherlock!");

    const complete = events.find((e) => e.type === "turn_complete");
    expect(complete).toBeTruthy();
    expect((complete as { stopReason: string }).stopReason).toBe("end_turn");
  });

  test("appends assistant message to conversation history", async () => {
    const client = mockClient([textResponse("response")]);
    const messages: Message[] = [{ role: "user", content: "hello" }];

    await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    expect(messages.length).toBe(2);
    expect(messages[1]!.role).toBe("assistant");
    expect((messages[1]!.content as ContentBlock[])[0]).toEqual({ type: "text", text: "response" });
  });

  test("collectText helper returns concatenated text", async () => {
    const client = mockClient([textResponse("Hello!")]);
    const messages: Message[] = [{ role: "user", content: "hi" }];

    const text = await collectText(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    expect(text).toBe("Hello!");
  });
});

// ---------------------------------------------------------------------------
// Multi-Turn Tool Use
// ---------------------------------------------------------------------------

describe("conversation: tool use", () => {
  test("executes tool calls and loops back", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([{ id: "tu_1", name: "bash", input: { command: "echo tool-test" } }]);
      }
      return textResponse("Tool done! Output was captured.");
    });

    const messages: Message[] = [{ role: "user", content: "run echo" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
      }),
    );

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBe(1);
    expect((toolCalls[0] as { toolName: string }).toolName).toBe("bash");

    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults.length).toBe(1);
    expect((toolResults[0] as { content: string }).content).toContain("tool-test");

    const complete = events.find((e) => e.type === "turn_complete");
    expect(complete).toBeTruthy();

    // Should have: user msg, assistant (tool_use), user (tool_result), assistant (text)
    expect(messages.length).toBe(4);
  });

  test("handles multiple tool calls in a single response", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([
          { id: "tu_a", name: "bash", input: { command: "echo first" } },
          { id: "tu_b", name: "bash", input: { command: "echo second" } },
        ]);
      }
      return textResponse("Both tools executed.");
    });

    const messages: Message[] = [{ role: "user", content: "run two" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
      }),
    );

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBe(2);

    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults.length).toBe(2);
  });

  test("handles multi-round tool use (tool → tool → text)", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([{ id: "tu_1", name: "bash", input: { command: "echo round1" } }]);
      }
      if (callNum === 2) {
        return toolUseResponse([{ id: "tu_2", name: "bash", input: { command: "echo round2" } }]);
      }
      return textResponse("Done after two rounds.");
    });

    const messages: Message[] = [{ role: "user", content: "multi-round" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
      }),
    );

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBe(2);

    // 3 API calls total
    expect(client.callCount).toBe(3);
  });

  test("tool results feed back with correct tool_use_id", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([{ id: "tu_check", name: "bash", input: { command: "echo check" } }]);
      }
      return textResponse("checked");
    });

    const messages: Message[] = [{ role: "user", content: "check" }];

    await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
      }),
    );

    // The tool result message should contain the correct tool_use_id
    const toolResultMsg = messages[2]; // user message with tool results
    expect(toolResultMsg!.role).toBe("user");
    const blocks = toolResultMsg!.content as ToolResultBlock[];
    expect(blocks[0]!.tool_use_id).toBe("tu_check");
  });
});

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

describe("conversation: error handling", () => {
  test("yields error event on API failure", async () => {
    const client = mockClient(() => {
      throw new Error("API call failed: 500");
    });

    const messages: Message[] = [{ role: "user", content: "boom" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect((errors[0] as { error: Error }).error.message).toContain("500");
  });

  test("marks rate limit ClaudeApiError as recoverable", async () => {
    const client = mockClient(() => {
      throw new ClaudeApiError(429, "rate_limit_error", "Rate limit exceeded");
    });

    const messages: Message[] = [{ role: "user", content: "too fast" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect((errors[0] as { recoverable: boolean }).recoverable).toBe(true);
  });

  test("marks overloaded ClaudeApiError as recoverable", async () => {
    const client = mockClient(() => {
      throw new ClaudeApiError(529, "overloaded_error", "Overloaded");
    });

    const messages: Message[] = [{ role: "user", content: "busy" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect((errors[0] as { recoverable: boolean }).recoverable).toBe(true);
  });

  test("marks server error ClaudeApiError as recoverable", async () => {
    const client = mockClient(() => {
      throw new ClaudeApiError(500, "api_error", "Internal server error");
    });

    const messages: Message[] = [{ role: "user", content: "server issue" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect((errors[0] as { recoverable: boolean }).recoverable).toBe(true);
  });

  test("marks auth ClaudeApiError as not recoverable", async () => {
    const client = mockClient(() => {
      throw new ClaudeApiError(401, "authentication_error", "Invalid API key");
    });

    const messages: Message[] = [{ role: "user", content: "bad auth" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect((errors[0] as { recoverable: boolean }).recoverable).toBe(false);
  });

  test("marks network timeout as recoverable", async () => {
    const client = mockClient(() => {
      throw new Error("Request timeout after 30000ms");
    });

    const messages: Message[] = [{ role: "user", content: "slow" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect((errors[0] as { recoverable: boolean }).recoverable).toBe(true);
  });

  test("marks generic errors as not recoverable", async () => {
    const client = mockClient(() => {
      throw new Error("unexpected error");
    });

    const messages: Message[] = [{ role: "user", content: "oops" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect((errors[0] as { recoverable: boolean }).recoverable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Max Turns Protection
// ---------------------------------------------------------------------------

describe("conversation: max turns", () => {
  test("stops after maxTurns", async () => {
    // Every response requests another tool call — infinite loop
    const client = mockClient(() => {
      return toolUseResponse([{ id: `tu_${Date.now()}`, name: "bash", input: { command: "echo loop" } }]);
    });

    const messages: Message[] = [{ role: "user", content: "loop forever" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
        maxTurns: 3,
      }),
    );

    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect((errors[0] as { error: Error }).error.message).toContain("maximum turns");
    expect(client.callCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Usage Tracking
// ---------------------------------------------------------------------------

describe("conversation: usage tracking", () => {
  test("turn_complete includes usage info", async () => {
    const resp: AccumulatedResponse = {
      id: "msg_test",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "hi" }],
      stopReason: "end_turn",
      stopSequence: null,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 900,
      },
    };

    const client = mockClient([resp]);
    const messages: Message[] = [{ role: "user", content: "test" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const complete = events.find((e) => e.type === "turn_complete") as {
      usage: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number };
    };
    expect(complete.usage.inputTokens).toBe(1000);
    expect(complete.usage.outputTokens).toBe(200);
    expect(complete.usage.cacheCreationTokens).toBe(50);
    expect(complete.usage.cacheReadTokens).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// Stop Reasons
// ---------------------------------------------------------------------------

describe("conversation: stop reasons", () => {
  test("handles max_tokens by continuing the conversation", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        // First call: Claude gets cut off at max_tokens
        return textResponse("truncated respo", "max_tokens");
      }
      // Second call: Claude continues and finishes
      return textResponse("nse. Here is the complete answer.");
    });

    const messages: Message[] = [{ role: "user", content: "long question" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    // Should have made 2 API calls (max_tokens → continue → end_turn)
    expect(client.callCount).toBe(2);

    // Should yield text deltas from both calls
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBe(2);
    expect((textDeltas[0] as { text: string }).text).toBe("truncated respo");
    expect((textDeltas[1] as { text: string }).text).toBe("nse. Here is the complete answer.");

    // Should still yield a turn_complete at the end
    const complete = events.find((e) => e.type === "turn_complete");
    expect(complete).toBeTruthy();
    expect((complete as { stopReason: string }).stopReason).toBe("end_turn");

    // Messages should include: user + assistant(truncated) + user(continue) + assistant(final)
    expect(messages.length).toBe(4);
    expect(messages[2]!.role).toBe("user");
    expect(messages[2]!.content).toBe("Continue from where you left off.");
  });

  test("handles pause_turn by continuing the loop", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        // Server tool hit iteration limit — return pause_turn
        return {
          id: `msg_${Date.now()}`,
          model: "claude-opus-4-6",
          content: [{ type: "text", text: "Searching..." }],
          stopReason: "pause_turn" as StopReason,
          stopSequence: null,
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      }
      // Second call completes normally
      return textResponse("Search complete. Here are the results.");
    });

    const messages: Message[] = [{ role: "user", content: "search for X" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    // Should have made 2 API calls (pause_turn → end_turn)
    expect(client.callCount).toBe(2);

    // Should still yield a turn_complete at the end
    const complete = events.find((e) => e.type === "turn_complete");
    expect(complete).toBeTruthy();
    expect((complete as { stopReason: string }).stopReason).toBe("end_turn");

    // Messages should include both assistant responses
    expect(messages.length).toBe(3); // user + assistant(pause) + assistant(final)
  });

  test("handles refusal as terminal stop reason", async () => {
    const client = mockClient([
      {
        id: "msg_refusal",
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "I cannot help with that." }],
        stopReason: "refusal" as StopReason,
        stopSequence: null,
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    ]);

    const messages: Message[] = [{ role: "user", content: "bad request" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
      }),
    );

    const complete = events.find((e) => e.type === "turn_complete") as { stopReason: string };
    expect(complete.stopReason).toBe("refusal");
    expect(client.callCount).toBe(1); // Should NOT loop
  });
});

// ---------------------------------------------------------------------------
// Pending Messages Queue Injection
// ---------------------------------------------------------------------------

describe("conversation: pending messages injection", () => {
  test("no-op when pendingMessages is not provided", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([{ id: "tu_1", name: "bash", input: { command: "echo hi" } }]);
      }
      return textResponse("Done.");
    });

    const messages: Message[] = [{ role: "user", content: "do something" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
        // no pendingMessages
      }),
    );

    // Should work normally without queued_messages events
    const queuedEvents = events.filter((e) => e.type === "queued_messages");
    expect(queuedEvents.length).toBe(0);

    const complete = events.find((e) => e.type === "turn_complete");
    expect(complete).toBeTruthy();
  });

  test("no-op when pendingMessages returns empty array", async () => {
    let callNum = 0;
    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([{ id: "tu_1", name: "bash", input: { command: "echo hi" } }]);
      }
      return textResponse("Done.");
    });

    const messages: Message[] = [{ role: "user", content: "do something" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
        pendingMessages: () => [],
      }),
    );

    const queuedEvents = events.filter((e) => e.type === "queued_messages");
    expect(queuedEvents.length).toBe(0);
  });

  test("injects queued messages alongside tool results", async () => {
    let callNum = 0;
    const pendingQueue = ["also check this", "and this too"];

    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([{ id: "tu_1", name: "bash", input: { command: "echo hi" } }]);
      }
      return textResponse("Got it — processed everything.");
    });

    const messages: Message[] = [{ role: "user", content: "do something" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
        pendingMessages: () => {
          const drained = [...pendingQueue];
          pendingQueue.length = 0;
          return drained;
        },
      }),
    );

    // Should have emitted a queued_messages event
    const queuedEvents = events.filter((e) => e.type === "queued_messages");
    expect(queuedEvents.length).toBe(1);
    expect((queuedEvents[0] as { messages: string[] }).messages).toEqual([
      "also check this",
      "and this too",
    ]);

    // The tool result user message should contain both tool_result blocks AND text blocks
    // messages: [user, assistant(tool_use), user(tool_results + queued text), assistant(final)]
    expect(messages.length).toBe(4);
    const toolResultMsg = messages[2]!;
    expect(toolResultMsg.role).toBe("user");
    const blocks = toolResultMsg.content as ContentBlock[];

    // First block: tool_result
    expect(blocks[0]!.type).toBe("tool_result");

    // Remaining blocks: text blocks from queued messages
    const textBlocks = blocks.filter((b) => b.type === "text");
    expect(textBlocks.length).toBe(2);
    expect((textBlocks[0] as { text: string }).text).toBe("also check this");
    expect((textBlocks[1] as { text: string }).text).toBe("and this too");
  });

  test("injects queued messages after turn_complete and continues", async () => {
    let callNum = 0;
    let drainCount = 0;

    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return textResponse("Here's my first answer.");
      }
      // Second call: responds to the queued message
      return textResponse("And here's my response to your follow-up.");
    });

    const messages: Message[] = [{ role: "user", content: "first question" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
        pendingMessages: () => {
          drainCount++;
          // First drain (after turn_complete of call 1): return a queued message
          if (drainCount === 1) {
            return ["follow-up question"];
          }
          // Second drain (after turn_complete of call 2): nothing
          return [];
        },
      }),
    );

    // Should have made 2 API calls
    expect(client.callCount).toBe(2);

    // Should have emitted queued_messages event
    const queuedEvents = events.filter((e) => e.type === "queued_messages");
    expect(queuedEvents.length).toBe(1);
    expect((queuedEvents[0] as { messages: string[] }).messages).toEqual(["follow-up question"]);

    // Should have 2 turn_complete events
    const completes = events.filter((e) => e.type === "turn_complete");
    expect(completes.length).toBe(2);

    // Messages: user + assistant(1) + user(queued) + assistant(2)
    expect(messages.length).toBe(4);
    expect(messages[2]!.role).toBe("user");
    expect(messages[2]!.content).toBe("follow-up question");
  });

  test("combines multiple queued messages after turn_complete", async () => {
    let callNum = 0;
    let drainCount = 0;

    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return textResponse("First answer.");
      }
      return textResponse("Responding to both follow-ups.");
    });

    const messages: Message[] = [{ role: "user", content: "start" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
        pendingMessages: () => {
          drainCount++;
          if (drainCount === 1) {
            return ["follow-up A", "follow-up B"];
          }
          return [];
        },
      }),
    );

    // The queued messages should be joined with double newlines
    expect(messages[2]!.role).toBe("user");
    expect(messages[2]!.content).toBe("follow-up A\n\nfollow-up B");
  });

  test("queued messages during tool use AND after turn_complete", async () => {
    let callNum = 0;
    let drainCount = 0;

    const client = mockClient(() => {
      callNum++;
      if (callNum === 1) {
        return toolUseResponse([{ id: "tu_1", name: "bash", input: { command: "echo test" } }]);
      }
      if (callNum === 2) {
        return textResponse("Tool done, and I see your mid-stream message.");
      }
      return textResponse("And your after-response message too.");
    });

    const messages: Message[] = [{ role: "user", content: "run something" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: CORE_TOOLS,
        messages,
        pendingMessages: () => {
          drainCount++;
          if (drainCount === 1) {
            // During tool results
            return ["message during tools"];
          }
          if (drainCount === 2) {
            // After turn_complete
            return ["message after response"];
          }
          return [];
        },
      }),
    );

    // Should have 2 queued_messages events
    const queuedEvents = events.filter((e) => e.type === "queued_messages");
    expect(queuedEvents.length).toBe(2);
    expect((queuedEvents[0] as { messages: string[] }).messages).toEqual(["message during tools"]);
    expect((queuedEvents[1] as { messages: string[] }).messages).toEqual(["message after response"]);

    // 3 API calls total
    expect(client.callCount).toBe(3);
  });

  test("does not continue after turn_complete when no queued messages", async () => {
    const client = mockClient([textResponse("Simple answer.")]);
    const messages: Message[] = [{ role: "user", content: "simple question" }];

    const events = await collectEvents(
      runConversation(client as unknown as Parameters<typeof runConversation>[0], {
        system: [],
        tools: [],
        messages,
        pendingMessages: () => [],
      }),
    );

    expect(client.callCount).toBe(1);
    const completes = events.filter((e) => e.type === "turn_complete");
    expect(completes.length).toBe(1);
    expect(messages.length).toBe(2); // user + assistant only
  });
});

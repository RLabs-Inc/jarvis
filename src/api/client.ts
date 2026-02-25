// ---------------------------------------------------------------------------
// Claude API Client
// ---------------------------------------------------------------------------
//
// Raw fetch-based client for the Claude Messages API.
// Uses raw fetch instead of the SDK for full control over cache breakpoints —
// the core innovation of Jarvis's tiered context system.
//
// Supports:
// - System prompt with cache_control breakpoints between tiers
// - Tool definitions
// - Streaming (SSE) via eventsource-parser
// - Non-streaming mode
// - Proper error handling (rate limits, auth, network, overloaded)
// ---------------------------------------------------------------------------

import type { JarvisConfig } from "../config.ts";
import type {
  ClaudeRequest,
  ClaudeResponse,
  StreamEvent,
  Message,
  SystemBlock,
  ToolDefinition,
} from "./types.ts";
import { ClaudeApiError } from "./types.ts";
import { buildAuthHeaders } from "./auth.ts";
import { parseSSEStream, accumulateStream } from "./streaming.ts";
import type { AccumulatedResponse } from "./streaming.ts";

// ---------------------------------------------------------------------------
// Request Builder
// ---------------------------------------------------------------------------

export interface CallOptions {
  model?: string;
  maxTokens?: number;
  system?: SystemBlock[];
  tools?: ToolDefinition[];
  messages: Message[];
  stream?: boolean;
}

/** Build the API request body from call options and config defaults. */
export function buildRequest(options: CallOptions, config: JarvisConfig): ClaudeRequest {
  return {
    model: options.model ?? config.model,
    max_tokens: options.maxTokens ?? 32768,
    ...(options.system && options.system.length > 0 ? { system: options.system } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
    messages: options.messages,
    ...(options.stream !== undefined ? { stream: options.stream } : {}),
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ClaudeClient {
  private readonly headers: Record<string, string>;
  private readonly messagesUrl: string;

  constructor(private readonly config: JarvisConfig) {
    this.headers = buildAuthHeaders(config);
    this.messagesUrl = `${config.apiBaseUrl}/v1/messages`;
  }

  /**
   * Send a non-streaming request. Returns the complete response.
   */
  async call(options: CallOptions): Promise<ClaudeResponse> {
    const body = buildRequest({ ...options, stream: false }, this.config);
    const response = await this.doFetch(body);
    return (await response.json()) as ClaudeResponse;
  }

  /**
   * Send a streaming request. Returns an async generator of stream events.
   */
  async *stream(options: CallOptions): AsyncGenerator<StreamEvent> {
    const body = buildRequest({ ...options, stream: true }, this.config);
    const response = await this.doFetch(body);

    if (!response.body) {
      throw new ClaudeApiError(0, "no_body", "Response has no body for streaming");
    }

    yield* parseSSEStream(response.body);
  }

  /**
   * Send a streaming request and accumulate the full response.
   * Optionally invokes a callback on each text delta for real-time display.
   */
  async streamAndAccumulate(
    options: CallOptions,
    onTextDelta?: (text: string) => void,
  ): Promise<AccumulatedResponse> {
    const events = this.stream(options);
    return accumulateStream(events, onTextDelta);
  }

  /** Execute the fetch request, handling errors and timeouts. */
  private async doFetch(body: ClaudeRequest): Promise<Response> {
    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      response = await fetch(this.messagesUrl, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ClaudeApiError(
          0,
          "timeout",
          `Request timed out after ${this.config.requestTimeoutMs}ms`,
        );
      }
      throw new ClaudeApiError(
        0,
        "network_error",
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let requestId = response.headers.get("request-id") ?? undefined;
      let errorType = "api_error";
      let errorMessage = `${response.status} ${response.statusText}`;

      try {
        const errorBody = (await response.json()) as {
          error?: { type?: string; message?: string };
          request_id?: string;
        };
        if (errorBody.error) {
          errorType = errorBody.error.type ?? errorType;
          errorMessage = errorBody.error.message ?? errorMessage;
        }
        // Fallback: extract request_id from JSON body if not in header
        if (!requestId && errorBody.request_id) {
          requestId = errorBody.request_id;
        }
      } catch {
        // Response body wasn't JSON — use status text
      }

      throw new ClaudeApiError(response.status, errorType, errorMessage, requestId);
    }

    return response;
  }
}

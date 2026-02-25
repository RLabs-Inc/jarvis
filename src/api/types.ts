// ---------------------------------------------------------------------------
// Claude API Type Definitions
// ---------------------------------------------------------------------------
//
// Types for the Claude Messages API. These are hand-written to match the API
// surface we actually use, not a full SDK mirror. Raw fetch + these types
// gives us full control over cache breakpoints — the core innovation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cache Control
// ---------------------------------------------------------------------------

export interface CacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

// ---------------------------------------------------------------------------
// System Prompt (with cache breakpoints between tiers)
// ---------------------------------------------------------------------------

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  /** Add cache_control to cache large tool results for subsequent turns. */
  cache_control?: CacheControl;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Optional examples of valid inputs. Must conform to input_schema. ~20-50 tokens each. */
  input_examples?: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Extended Thinking
// ---------------------------------------------------------------------------

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ThinkingConfig {
  type: "enabled";
  budget_tokens: number;
}

/** Map thinking levels to budget tokens. */
export const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  off: 0,
  low: 5_000,
  medium: 16_000,
  high: 32_000,
};

// ---------------------------------------------------------------------------
// API Request
// ---------------------------------------------------------------------------

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system?: SystemBlock[];
  tools?: ToolDefinition[];
  messages: Message[];
  stream?: boolean;
  /** Extended thinking — only included when thinking is enabled. */
  thinking?: ThinkingConfig;
  /**
   * Temperature — required to be 1 when extended thinking is enabled.
   * Only included in the request when thinking is on.
   */
  temperature?: number;
}

// ---------------------------------------------------------------------------
// API Response (non-streaming)
// ---------------------------------------------------------------------------

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded";

/**
 * Per-TTL cache creation breakdown. Returned when mixing cache TTLs.
 * The sum of all fields equals cache_creation_input_tokens.
 */
export interface CacheCreationDetail {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  /** Per-TTL breakdown when using mixed cache durations (1h + 5m). */
  cache_creation?: CacheCreationDetail;
}

export interface ClaudeResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: StopReason;
  stop_sequence: string | null;
  usage: Usage;
}

// ---------------------------------------------------------------------------
// SSE Streaming Events
// ---------------------------------------------------------------------------

export interface MessageStartEvent {
  type: "message_start";
  message: ClaudeResponse;
}

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block:
    | TextBlock
    | { type: "thinking"; thinking: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
}

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface ThinkingDelta {
  type: "thinking_delta";
  thinking: string;
}

export interface InputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: TextDelta | ThinkingDelta | InputJsonDelta;
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: StopReason;
    stop_sequence?: string | null;
  };
  usage: {
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    input_tokens?: number;
  };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface PingEvent {
  type: "ping";
}

export interface StreamErrorEvent {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | StreamErrorEvent;

// ---------------------------------------------------------------------------
// Usage / Rate Limit Info
// ---------------------------------------------------------------------------

export interface UsagePeriod {
  utilization: number;
  resets_at: string;
}

export interface UsageInfo {
  five_hour: UsagePeriod;
  seven_day: UsagePeriod;
}

// ---------------------------------------------------------------------------
// API Error Response
// ---------------------------------------------------------------------------

export interface ApiErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Client Error Types
// ---------------------------------------------------------------------------

export class ClaudeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorType: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ClaudeApiError";
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isOverloaded(): boolean {
    return this.status === 529;
  }

  get isServerError(): boolean {
    return this.status === 500;
  }
}

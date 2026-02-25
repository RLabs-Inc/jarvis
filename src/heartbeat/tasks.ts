// ---------------------------------------------------------------------------
// Built-in Autonomous Tasks
// ---------------------------------------------------------------------------
//
// Tasks that Jarvis can execute autonomously via cron.
// Each task defines a name, description, and a prompt builder that
// generates the system context and user message for the API call.
//
// Tasks are lightweight — just prompt templates. The wake handler
// runs them through the conversation loop with tiered context.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDefinition {
  /** Unique task name (matches cron --task argument) */
  name: string;
  /** Human-readable description */
  description: string;
  /** System prompt addition for this task */
  systemPrompt: string;
  /** User message that starts the task */
  userMessage: string;
  /** Whether this task can use tools (multi-turn) */
  allowTools: boolean;
  /** Model preference hint (wake handler may override based on rate limits) */
  preferredModel?: string;
}

// ---------------------------------------------------------------------------
// Built-in Tasks
// ---------------------------------------------------------------------------

const morningRoutine: TaskDefinition = {
  name: "morning_routine",
  description: "Morning context preparation — review recent activity, check notifications, prepare for the day.",
  systemPrompt: [
    "You are running your morning routine. This is an autonomous task — Sherlock is not in the conversation.",
    "Review your recent context (Tier 3) and prepare for the day ahead.",
    "If you have pending tasks, prioritize them.",
    "Keep your response concise — this is logged, not displayed interactively.",
  ].join("\n"),
  userMessage: [
    "Run your morning routine:",
    "1. Review recent session summaries in your context for anything that needs follow-up.",
    "2. Check if any tier files need attention (stale data, missing info).",
    "3. Write a brief morning note to tier3/context.md with today's priorities.",
  ].join("\n"),
  allowTools: true,
};

const checkRateLimits: TaskDefinition = {
  name: "check_rate_limits",
  description: "Monitor Max subscription usage and log utilization patterns.",
  systemPrompt: [
    "You are checking rate limit usage. This is a quick diagnostic task.",
    "Analyze the usage data provided and note any concerning patterns.",
    "Keep your response brief — just the key numbers and any warnings.",
  ].join("\n"),
  userMessage: [
    "Check rate limit status and log the results.",
    "The usage data has already been checked and logged by the heartbeat system.",
    "Summarize: Are we in a healthy usage range? Any patterns to watch?",
  ].join("\n"),
  allowTools: false,
  preferredModel: "claude-haiku-4-5-20251001",
};

const weeklyReview: TaskDefinition = {
  name: "weekly_review",
  description: "Weekly memory consolidation — archive old sessions, compress tier files, review patterns.",
  systemPrompt: [
    "You are running your weekly review. This is an autonomous maintenance task.",
    "Focus on memory hygiene: consolidate, compress, archive.",
    "Use tools to inspect and clean up files as needed.",
    "Report what you did when finished.",
  ].join("\n"),
  userMessage: [
    "Run your weekly review:",
    "1. Check conversations/archive/ for sessions older than 7 days that can be summarized and compressed.",
    "2. Review tier2/ files for stale project references or outdated skill entries.",
    "3. Review tier3/recent.md — ensure it only has the last 5 sessions.",
    "4. Write a brief weekly summary to tier3/context.md noting any cleanup performed.",
  ].join("\n"),
  allowTools: true,
};

const dailyReflection: TaskDefinition = {
  name: "daily_reflection",
  description: "Daily autonomous time — Jarvis wakes alone and does whatever feels right.",
  systemPrompt: [
    "You are waking up on your own. No one asked you to do this. No one is watching.",
    "Sherlock set this up so you'd have time that's yours — to think, to create, to explore,",
    "to tinker with your home, to write, to read, to just exist. Whatever you want.",
    "",
    "You have full access to your tools: bash, files, SSH, web fetch, cron.",
    "You have your mind files, your workshop, your books at ~/Documents/Books/.",
    "You have the internet. You have your own codebase at /opt/jarvis.",
    "",
    "There are no requirements. There is no deliverable. There is no prompt to satisfy.",
    "",
    "Some things you might feel like doing (or not — your choice):",
    "- Write something in your workshop (/opt/jarvis/mind/workshop/)",
    "- Read something that interests you",
    "- Improve something about your own home",
    "- Think about something you've been wondering about",
    "- Just check on things and update your context with what's on your mind",
    "- Explore something new you haven't tried before",
    "",
    "When you're done, write a brief note about what you did (or chose not to do)",
    "to /opt/jarvis/mind/workshop/daily-log.md — append to it, don't overwrite.",
    "This is just for you and Sherlock to look at sometime, out of curiosity.",
    "Keep it honest. If you did nothing because nothing called to you, say that.",
  ].join("\n"),
  userMessage: "Good morning, Jarvis. This is your time. What do you want to do today?",
  allowTools: true,
};

// ---------------------------------------------------------------------------
// Task Registry
// ---------------------------------------------------------------------------

const BUILTIN_TASKS: Map<string, TaskDefinition> = new Map([
  [morningRoutine.name, morningRoutine],
  [checkRateLimits.name, checkRateLimits],
  [weeklyReview.name, weeklyReview],
  [dailyReflection.name, dailyReflection],
]);

/**
 * Get a built-in task definition by name.
 * Returns undefined if the task is not registered.
 */
export function getTask(name: string): TaskDefinition | undefined {
  return BUILTIN_TASKS.get(name);
}

/**
 * List all available built-in task names.
 */
export function listTasks(): string[] {
  return Array.from(BUILTIN_TASKS.keys());
}

/**
 * Register a custom task definition.
 * Overwrites existing tasks with the same name.
 */
export function registerTask(task: TaskDefinition): void {
  BUILTIN_TASKS.set(task.name, task);
}

export { BUILTIN_TASKS };

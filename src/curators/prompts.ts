// ---------------------------------------------------------------------------
// Curation Prompt Templates
// ---------------------------------------------------------------------------
//
// Prompts that guide the curator sub-agents to extract and update tier content
// from session transcripts. Each prompt produces structured output that the
// curator can parse into file updates.
//
// Output format: XML-delimited file sections. Each file's content is wrapped
// in <file name="filename.md">...</file> tags for reliable parsing.
// ---------------------------------------------------------------------------

import type { Message } from "../api/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the current date in YYYY-MM-DD format.
 * Used to inject temporal awareness into curator prompts.
 */
function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Transcript Formatting
// ---------------------------------------------------------------------------

/**
 * Format a transcript into a readable string for the curator prompt.
 * Keeps it compact — curators don't need raw ContentBlock detail,
 * just the flow of conversation and key decisions.
 */
export function formatTranscript(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "Assistant";

    if (typeof msg.content === "string") {
      lines.push(`${role}: ${msg.content}`);
    } else {
      // ContentBlock array — extract text and tool use summaries
      const parts: string[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push(block.text);
        } else if (block.type === "tool_use") {
          parts.push(`[Tool: ${block.name}(${JSON.stringify(block.input)})]`);
        } else if (block.type === "tool_result") {
          const status = block.is_error ? "ERROR" : "OK";
          // Truncate long tool results for the curator
          const content = block.content.length > 500
            ? block.content.slice(0, 500) + "...[truncated]"
            : block.content;
          parts.push(`[Tool Result (${status}): ${content}]`);
        }
      }
      if (parts.length > 0) {
        lines.push(`${role}: ${parts.join("\n")}`);
      }
    }
  }

  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Timestamp Guidelines (shared across curators)
// ---------------------------------------------------------------------------

const TIMESTAMP_GUIDELINES = `
## Timestamp Guidelines

Always include timestamps in your output. This is critical for memory curation — dates
enable staleness detection, pruning decisions, and temporal awareness.

- **File-level**: Every file MUST start with \`> Last updated: YYYY-MM-DD\` on the line
  after the heading. Update this to today's date whenever you modify the file.
- **Session entries** (recent.md): Use \`## Session — YYYY-MM-DD HH:MM BRT\` format.
- **Project entries** (projects.md): Include \`- **Last updated**: YYYY-MM-DD\` in each project.
- **Lessons/events**: Include the date they occurred, e.g., "(learned 2026-02-24)".
- **Tasks** (tasks.md): Include when tasks were added, e.g., "- [ ] Fix auth test (added 2026-02-25)".
- **Use ISO format** (YYYY-MM-DD) consistently for all dates.
- **Staleness cue**: If an entry hasn't been updated in a long time and seems irrelevant,
  it may be a candidate for removal or archival — use your judgment.
`;

// ---------------------------------------------------------------------------
// Tier 3 Curation Prompt (Short-term — Haiku)
// ---------------------------------------------------------------------------

/**
 * Build the Tier 3 curation prompt.
 * Tier 3 tracks recent sessions, active tasks, and immediate context.
 *
 * The curator receives the session transcript and current tier3 files,
 * and returns updated content for each file.
 */
export function buildTier3Prompt(
  transcript: string,
  currentRecent: string,
  currentTasks: string,
  currentContext: string,
  maxRecentSessions: number,
): string {
  const currentDate = today();

  return `You are a memory curator for an AI vessel named Jarvis. Your job is to update the short-term memory (Tier 3) after a session ends.

Today's date: ${currentDate}

## Your Task

Read the session transcript below, then update three files:

1. **recent.md** — Session summaries (most recent first). Keep the last ${maxRecentSessions} sessions. Add a new summary at the top for this session. Each summary should be 2-4 bullet points capturing what happened, key decisions, and outcomes. Use the format: \`## Session — YYYY-MM-DD HH:MM BRT\`.

2. **tasks.md** — Active tasks and todos. Add new tasks discovered in the session (with date added). Mark completed tasks as done. Remove tasks that are no longer relevant.

3. **context.md** — Immediate context for the next session. What's the current state? What was the user working on? What needs to happen next? This should be a brief snapshot (under 500 words) that helps Jarvis pick up exactly where things left off.
${TIMESTAMP_GUIDELINES}
## Current File Contents

<current_recent>
${currentRecent || "(empty)"}
</current_recent>

<current_tasks>
${currentTasks || "(empty)"}
</current_tasks>

<current_context>
${currentContext || "(empty)"}
</current_context>

## Session Transcript

<transcript>
${transcript}
</transcript>

## Output Format

Return the updated content for each file, wrapped in XML tags. Return ONLY the file contents — no explanations, no commentary.

<file name="recent.md">
(updated recent sessions content here)
</file>

<file name="tasks.md">
(updated tasks content here)
</file>

<file name="context.md">
(updated context content here)
</file>`;
}

// ---------------------------------------------------------------------------
// Tier 2 Curation Prompt (Medium-term — Sonnet)
// ---------------------------------------------------------------------------

/**
 * Build the Tier 2 curation prompt.
 * Tier 2 tracks active projects, skills, and focus areas.
 *
 * The curator receives the session transcript and current tier2 files,
 * and returns updated content for each file.
 */
export function buildTier2Prompt(
  transcript: string,
  currentProjects: string,
  currentSkills: string,
  currentFocus: string,
): string {
  const currentDate = today();

  return `You are a memory curator for an AI vessel named Jarvis. Your job is to update the medium-term memory (Tier 2) after a session ends.

Today's date: ${currentDate}

## Your Task

Read the session transcript below, then update three files:

1. **projects.md** — Active project states. Update any projects that were discussed. Add new projects if they were started. Note progress, milestones, blockers, and current status. Each project entry should include a \`- **Last updated**: YYYY-MM-DD\` field. Keep entries concise but informative.

2. **skills.md** — Skill inventory. If new capabilities were demonstrated or learned in this session, add them with the date learned. If existing skills were refined, update them. Don't remove skills — they accumulate.

3. **focus.md** — Current focus areas. What is the user currently focused on? What are the priorities? Update based on what the session reveals about current direction and interests.

## Important Guidelines

- Be conservative: only update what the session evidence supports
- Preserve existing content that wasn't contradicted by the session
- If nothing changed for a file, return the current content unchanged
- Keep each file under 3000 words to stay within token budgets
- Use markdown formatting consistently
${TIMESTAMP_GUIDELINES}
## Current File Contents

<current_projects>
${currentProjects || "(empty)"}
</current_projects>

<current_skills>
${currentSkills || "(empty)"}
</current_skills>

<current_focus>
${currentFocus || "(empty)"}
</current_focus>

## Session Transcript

<transcript>
${transcript}
</transcript>

## Output Format

Return the updated content for each file, wrapped in XML tags. Return ONLY the file contents — no explanations, no commentary.

<file name="projects.md">
(updated projects content here)
</file>

<file name="skills.md">
(updated skills content here)
</file>

<file name="focus.md">
(updated focus content here)
</file>`;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Parse file updates from a curator response.
 * Extracts content between <file name="X">...</file> tags.
 *
 * Returns a Map of filename → content.
 */
export function parseCuratorResponse(response: string): Map<string, string> {
  const files = new Map<string, string>();
  const pattern = /<file\s+name="([^"]+)">\s*([\s\S]*?)\s*<\/file>/g;

  let match;
  while ((match = pattern.exec(response)) !== null) {
    const filename = match[1]!;
    const content = match[2]!.trim();
    files.set(filename, content);
  }

  return files;
}

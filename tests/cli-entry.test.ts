import { describe, test, expect } from "bun:test";
import { parseArgs } from "../src/cli-entry.ts";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  test("no args → interactive", () => {
    expect(parseArgs([])).toEqual({ command: "interactive" });
  });

  test("wake with --task flag", () => {
    expect(parseArgs(["wake", "--task", "morning_routine"])).toEqual({
      command: "wake",
      taskName: "morning_routine",
    });
  });

  test("wake with positional task name", () => {
    expect(parseArgs(["wake", "weekly_review"])).toEqual({
      command: "wake",
      taskName: "weekly_review",
    });
  });

  test("wake without task name", () => {
    const result = parseArgs(["wake"]);
    expect(result.command).toBe("wake");
    expect(result.taskName).toBeUndefined();
  });

  test("status command", () => {
    expect(parseArgs(["status"])).toEqual({ command: "status" });
  });

  test("tiers command", () => {
    expect(parseArgs(["tiers"])).toEqual({ command: "tiers" });
  });

  test("tasks command", () => {
    expect(parseArgs(["tasks"])).toEqual({ command: "tasks" });
  });

  test("help command", () => {
    expect(parseArgs(["help"])).toEqual({ command: "help" });
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
    expect(parseArgs(["-h"])).toEqual({ command: "help" });
  });

  test("unknown command → help", () => {
    expect(parseArgs(["unknown"])).toEqual({ command: "help" });
    expect(parseArgs(["foo", "bar"])).toEqual({ command: "help" });
  });

  test("commands are case insensitive", () => {
    expect(parseArgs(["STATUS"])).toEqual({ command: "status" });
    expect(parseArgs(["Wake", "--task", "test"])).toEqual({
      command: "wake",
      taskName: "test",
    });
  });
});

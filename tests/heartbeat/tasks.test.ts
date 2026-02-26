import { describe, test, expect } from "bun:test";
import {
  getTask,
  listTasks,
  registerTask,
  BUILTIN_TASKS,
} from "../../src/heartbeat/tasks.ts";
import type { TaskDefinition } from "../../src/heartbeat/tasks.ts";

// ---------------------------------------------------------------------------
// Task Registry
// ---------------------------------------------------------------------------

describe("getTask", () => {
  test("returns morning_routine task", () => {
    const task = getTask("morning_routine");
    expect(task).toBeDefined();
    expect(task!.name).toBe("morning_routine");
    expect(task!.allowTools).toBe(true);
    expect(task!.systemPrompt).toBeTruthy();
    expect(task!.userMessage).toBeTruthy();
  });

  test("returns check_rate_limits task", () => {
    const task = getTask("check_rate_limits");
    expect(task).toBeDefined();
    expect(task!.name).toBe("check_rate_limits");
    expect(task!.allowTools).toBe(false);
    expect(task!.preferredModel).toBe("claude-haiku-4-5-20251001");
  });

  test("returns weekly_review task", () => {
    const task = getTask("weekly_review");
    expect(task).toBeDefined();
    expect(task!.name).toBe("weekly_review");
    expect(task!.allowTools).toBe(true);
  });

  test("returns daily_reflection task", () => {
    const task = getTask("daily_reflection");
    expect(task).toBeDefined();
    expect(task!.name).toBe("daily_reflection");
    expect(task!.allowTools).toBe(true);
    expect(task!.minModel).toBe("claude-sonnet-4-6");
  });

  test("returns undefined for unknown task", () => {
    expect(getTask("nonexistent_task")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe("listTasks", () => {
  test("lists all built-in task names", () => {
    const names = listTasks();
    expect(names).toContain("morning_routine");
    expect(names).toContain("check_rate_limits");
    expect(names).toContain("weekly_review");
    expect(names).toContain("daily_reflection");
    expect(names.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// registerTask
// ---------------------------------------------------------------------------

describe("registerTask", () => {
  test("registers a custom task", () => {
    const custom: TaskDefinition = {
      name: "test_custom_task",
      description: "Test task for testing",
      systemPrompt: "You are a test.",
      userMessage: "Do a test thing.",
      allowTools: false,
    };

    registerTask(custom);

    const retrieved = getTask("test_custom_task");
    expect(retrieved).toBeDefined();
    expect(retrieved!.description).toBe("Test task for testing");

    // Clean up
    BUILTIN_TASKS.delete("test_custom_task");
  });

  test("overwrites existing task with same name", () => {
    const original: TaskDefinition = {
      name: "test_overwrite",
      description: "Original",
      systemPrompt: "Original prompt",
      userMessage: "Original message",
      allowTools: false,
    };

    const updated: TaskDefinition = {
      ...original,
      description: "Updated",
    };

    registerTask(original);
    registerTask(updated);

    const retrieved = getTask("test_overwrite");
    expect(retrieved!.description).toBe("Updated");

    // Clean up
    BUILTIN_TASKS.delete("test_overwrite");
  });

  test("registers a task with minModel", () => {
    const task: TaskDefinition = {
      name: "test_min_model",
      description: "Task with minimum model requirement",
      systemPrompt: "Test prompt",
      userMessage: "Test message",
      allowTools: true,
      minModel: "claude-sonnet-4-6",
    };

    registerTask(task);
    const retrieved = getTask("test_min_model");
    expect(retrieved!.minModel).toBe("claude-sonnet-4-6");

    // Clean up
    BUILTIN_TASKS.delete("test_min_model");
  });
});

// ---------------------------------------------------------------------------
// Task Content Quality
// ---------------------------------------------------------------------------

describe("task content quality", () => {
  test("all tasks have non-empty required fields", () => {
    for (const [name, task] of BUILTIN_TASKS) {
      expect(task.name).toBe(name);
      expect(task.description.length).toBeGreaterThan(10);
      expect(task.systemPrompt.length).toBeGreaterThan(10);
      expect(task.userMessage.length).toBeGreaterThan(10);
    }
  });

  test("all tasks have unique names", () => {
    const names = listTasks();
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("tasks with minModel have a known model", () => {
    const knownModels = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
    for (const [, task] of BUILTIN_TASKS) {
      if (task.minModel) {
        expect(knownModels).toContain(task.minModel);
      }
    }
  });
});

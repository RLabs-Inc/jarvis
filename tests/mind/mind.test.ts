import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { validateMindDir, ensureMindDir, MIND_SUBDIRS } from "../../src/mind.ts";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `jarvis-test-mind-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("validateMindDir", () => {
  test("reports all missing when directory is empty", () => {
    const missing = validateMindDir(TEST_DIR);
    expect(missing).toHaveLength(MIND_SUBDIRS.length);
  });

  test("reports no missing when all subdirs exist", () => {
    for (const sub of MIND_SUBDIRS) {
      mkdirSync(join(TEST_DIR, sub), { recursive: true });
    }
    const missing = validateMindDir(TEST_DIR);
    expect(missing).toHaveLength(0);
  });

  test("reports only specific missing directories", () => {
    // Create all except tier3
    for (const sub of MIND_SUBDIRS) {
      if (sub !== "tier3") {
        mkdirSync(join(TEST_DIR, sub), { recursive: true });
      }
    }
    const missing = validateMindDir(TEST_DIR);
    expect(missing).toEqual(["tier3"]);
  });
});

describe("ensureMindDir", () => {
  test("creates all required subdirectories", () => {
    ensureMindDir(TEST_DIR);
    for (const sub of MIND_SUBDIRS) {
      expect(existsSync(join(TEST_DIR, sub))).toBe(true);
    }
  });

  test("is idempotent — safe to call multiple times", () => {
    ensureMindDir(TEST_DIR);
    ensureMindDir(TEST_DIR); // second call should not throw
    for (const sub of MIND_SUBDIRS) {
      expect(existsSync(join(TEST_DIR, sub))).toBe(true);
    }
  });

  test("creates only missing directories when some exist", () => {
    mkdirSync(join(TEST_DIR, "tier1"), { recursive: true });
    ensureMindDir(TEST_DIR);
    for (const sub of MIND_SUBDIRS) {
      expect(existsSync(join(TEST_DIR, sub))).toBe(true);
    }
  });
});

import { describe, test, expect, afterAll } from "bun:test";
import { readFile, writeFile } from "../../src/tools/files.ts";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `jarvis-test-files-${Date.now()}`);

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("readFile", () => {
  test("reads entire file", async () => {
    const path = join(TEST_DIR, "read-full.txt");
    await writeFile(path, "line1\nline2\nline3");
    const content = await readFile(path);
    expect(content).toBe("line1\nline2\nline3");
  });

  test("reads with offset", async () => {
    const path = join(TEST_DIR, "read-offset.txt");
    await writeFile(path, "line0\nline1\nline2\nline3");
    const content = await readFile(path, 2);
    expect(content).toBe("line2\nline3");
  });

  test("reads with offset and limit", async () => {
    const path = join(TEST_DIR, "read-offset-limit.txt");
    await writeFile(path, "a\nb\nc\nd\ne");
    const content = await readFile(path, 1, 2);
    expect(content).toBe("b\nc");
  });

  test("throws on nonexistent file", async () => {
    await expect(readFile(join(TEST_DIR, "nope.txt"))).rejects.toThrow();
  });
});

describe("writeFile", () => {
  test("creates file and parent directories", async () => {
    const path = join(TEST_DIR, "deep", "nested", "dir", "file.txt");
    await writeFile(path, "hello vessel");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("hello vessel");
  });

  test("overwrites existing file", async () => {
    const path = join(TEST_DIR, "overwrite.txt");
    await writeFile(path, "first");
    await writeFile(path, "second");
    expect(readFileSync(path, "utf-8")).toBe("second");
  });

  test("handles empty content", async () => {
    const path = join(TEST_DIR, "empty.txt");
    await writeFile(path, "");
    expect(readFileSync(path, "utf-8")).toBe("");
  });
});

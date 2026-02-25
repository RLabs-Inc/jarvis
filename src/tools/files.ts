// ---------------------------------------------------------------------------
// File Operations
// ---------------------------------------------------------------------------
//
// Read and write files on the vessel filesystem.
// writeFile auto-creates parent directories.
// readFile supports offset/limit for large files.
// ---------------------------------------------------------------------------

import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Read File
// ---------------------------------------------------------------------------

/**
 * Read a file from the filesystem.
 * Supports optional line offset and limit for reading large files.
 */
export async function readFile(
  path: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const content = await fsReadFile(path, "utf-8");

  if (offset === undefined && limit === undefined) {
    return content;
  }

  const lines = content.split("\n");
  const start = offset ?? 0;
  const end = limit !== undefined ? start + limit : lines.length;
  return lines.slice(start, end).join("\n");
}

// ---------------------------------------------------------------------------
// Write File
// ---------------------------------------------------------------------------

/**
 * Write content to a file, creating parent directories if they don't exist.
 */
export async function writeFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await fsWriteFile(path, content, "utf-8");
}

import { describe, expect, it } from "bun:test";
import { buildAuthHeaders, isValidTokenFormat } from "../../src/api/auth.ts";
import type { JarvisConfig } from "../../src/config.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";

function makeConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  return { ...DEFAULT_CONFIG, authToken: "sk-ant-oat01-test-token-1234567890", ...overrides };
}

describe("buildAuthHeaders", () => {
  it("includes Bearer auth with token from config", () => {
    const config = makeConfig({ authToken: "sk-ant-oat01-my-secret-token" });
    const headers = buildAuthHeaders(config);
    expect(headers["Authorization"]).toBe("Bearer sk-ant-oat01-my-secret-token");
  });

  it("includes content-type JSON", () => {
    const headers = buildAuthHeaders(makeConfig());
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("includes anthropic-version header", () => {
    const headers = buildAuthHeaders(makeConfig());
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("includes required beta headers for OAuth tokens", () => {
    const headers = buildAuthHeaders(makeConfig());
    expect(headers["anthropic-beta"]).toContain("oauth-2025-04-20");
  });

  it("uses X-Api-Key for non-OAuth tokens", () => {
    const headers = buildAuthHeaders(makeConfig({ authToken: "sk-ant-api03-regular-key-12345678" }));
    expect(headers["X-Api-Key"]).toBe("sk-ant-api03-regular-key-12345678");
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["anthropic-beta"]).toBeUndefined();
  });
});

describe("isValidTokenFormat", () => {
  it("accepts valid setup-token format", () => {
    expect(isValidTokenFormat("sk-ant-oat01-abcdefghijklmnopq")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidTokenFormat("")).toBe(false);
  });

  it("rejects standard API key format", () => {
    expect(isValidTokenFormat("sk-ant-api03-abcdefghijklmnopq")).toBe(false);
  });

  it("rejects short tokens", () => {
    expect(isValidTokenFormat("sk-ant-oat01-ab")).toBe(false);
  });
});

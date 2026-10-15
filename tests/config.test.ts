import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/server/config.js";
import { testConfig } from "./helpers.js";

describe("admin password configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["x", "", "  ää 🔑  "])("preserves an explicitly configured environment value (%j)", async (password) => {
    vi.stubEnv("ADMIN_PASSWORD", password);
    const { adminPassword: _password, ...overrides } = await testConfig();
    expect(readConfig(overrides).adminPassword).toBe(password);
  });

  it("accepts an empty override instead of the environment password", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "environment-password");
    expect(readConfig(await testConfig({ adminPassword: "" })).adminPassword).toBe("");
  });

  it("reports an unconfigured password", async () => {
    vi.stubEnv("ADMIN_PASSWORD", undefined);
    const { adminPassword: _password, ...overrides } = await testConfig();
    expect(() => readConfig(overrides)).toThrow("ADMIN_PASSWORD must be configured.");
  });
});

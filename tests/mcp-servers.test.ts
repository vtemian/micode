// tests/mcp-servers.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { buildMcpServers, mergeMcpServers } from "../src/plugin-config";

const RESEARCH_KEYS = ["PERPLEXITY_API_KEY", "FIRECRAWL_API_KEY"] as const;

describe("buildMcpServers", () => {
  let originalKeys: Record<string, string | undefined>;

  beforeEach(() => {
    originalKeys = Object.fromEntries(RESEARCH_KEYS.map((key) => [key, process.env[key]]));
    for (const key of RESEARCH_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of RESEARCH_KEYS) {
      const value = originalKeys[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("registers context7 by default", () => {
    expect(Object.keys(buildMcpServers())).toEqual(["context7"]);
    expect(buildMcpServers().context7.command).toContain("@upstash/context7-mcp@latest");
  });

  it("omits context7 when the feature is disabled", () => {
    expect(buildMcpServers({ context7: false })).toEqual({});
  });

  it("keeps context7 when the feature is unset or explicitly enabled", () => {
    expect(Object.keys(buildMcpServers({}))).toContain("context7");
    expect(Object.keys(buildMcpServers({ context7: true }))).toContain("context7");
  });

  it("gates the research servers behind their API keys", () => {
    expect(Object.keys(buildMcpServers())).not.toContain("perplexity");

    process.env.PERPLEXITY_API_KEY = "test-key";
    process.env.FIRECRAWL_API_KEY = "test-key";
    expect(Object.keys(buildMcpServers())).toEqual(["context7", "perplexity", "firecrawl"]);
  });

  it("leaves every server disableable, so nothing is forced on a host", () => {
    // Regression guard for #49: context7 used to be unconditional and was
    // spread over the host config, so it could be neither replaced nor removed.
    expect(buildMcpServers({ context7: false })).toEqual({});
  });
});

describe("mergeMcpServers", () => {
  const hostContext7 = { type: "local" as const, command: ["my-own-context7"] };

  it("lets a host entry of the same name replace the bundled server", () => {
    const merged = mergeMcpServers({ context7: hostContext7 });
    expect(merged.context7.command).toEqual(["my-own-context7"]);
  });

  it("keeps host-only servers alongside the bundled ones", () => {
    const custom = { type: "local" as const, command: ["something-else"] };
    const merged = mergeMcpServers({ custom });

    expect(merged.custom).toEqual(custom);
    expect(Object.keys(merged)).toContain("context7");
  });

  it("registers the bundled servers when the host declares none", () => {
    expect(Object.keys(mergeMcpServers(undefined))).toEqual(["context7"]);
  });

  it("drops context7 entirely when disabled and unclaimed by the host", () => {
    expect(mergeMcpServers({}, { context7: false })).toEqual({});
  });
});

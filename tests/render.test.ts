import { afterEach, describe, expect, it } from "vitest";
import { render, renderJson } from "../src/render/combined";
import type { AgentStats, CombinedStats } from "../src/types";

const ORIGINAL_HOME = process.env.HOME;

function makeStats(overrides: Partial<CombinedStats> = {}): CombinedStats {
  return {
    agents: [],
    combinedDaily: [],
    allTimeTokens: 0,
    allTimeCost: 0,
    allTimeActiveDays: 0,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentStats> = {}): AgentStats {
  return {
    harness: "claude",
    sourcePath: "/tmp/stats-cache.json",
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheTokens: 0,
    totalCost: 0,
    totalTurns: 0,
    totalSessions: 0,
    activeDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    bestDay: { date: "", tokens: 0 },
    dailyActivity: [],
    modelActivity: [],
    projectActivity: [],
    hourlyActivity: [],
    ...overrides,
  };
}

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
});

describe("render", () => {
  it("shows a helpful empty state when no agent data is available", () => {
    const output = render(makeStats(), { weeks: 8 });

    expect(output).toContain("No AI coding agent data found.");
    expect(output).toContain("Checked the default local data locations");
    expect(output).toContain("OpenCode");
    expect(output).toContain("$XDG_DATA_HOME/opencode/opencode.db");
    expect(output).toContain("Application Support/opencode/opencode.db");
    expect(output).toContain("Claude Code");
    expect(output).toContain("~/.claude/projects/");
    expect(output).toContain("Codex");
    expect(output).toContain("~/.codex/sessions/");
    expect(output).toContain("Pi");
    expect(output).toContain("--claude");
  });
});

describe("renderJson", () => {
  it("redacts local source paths and absolute project paths", () => {
    process.env.HOME = "/home/alice";

    const output = JSON.parse(renderJson(makeStats({
      agents: [makeAgent({
        sourcePath: "/home/alice/.claude/stats-cache.json",
        projectActivity: [
          { project: "/home/alice/projects/secret-app", harness: "claude", tokens: 100 },
          { project: "relative-project", harness: "claude", tokens: 50 },
        ],
      })],
    })));

    expect(output.agents[0].sourcePath).toBe("~/.claude/stats-cache.json");
    expect(output.agents[0].projectActivity[0].project).toBe("secret-app");
    expect(output.agents[0].projectActivity[1].project).toBe("relative-project");
  });
});

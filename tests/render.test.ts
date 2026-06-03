import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderJson } from "../src/render/combined";
import type { AgentStats, CombinedStats } from "../src/types";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_COLUMNS = process.stdout.columns;

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
  Object.defineProperty(process.stdout, "columns", { value: ORIGINAL_COLUMNS, writable: true });
  vi.useRealTimers();
});

describe("render", () => {
  it("shows a helpful empty state when no agent data is available", () => {
    const output = render(makeStats(), { weeks: 8 });

    expect(output).toContain("No AI coding agent data found.");
    expect(output).toContain("Checked common local data locations");
    expect(output).toContain("OpenCode");
    expect(output).toContain("$XDG_DATA_HOME/opencode/opencode.db");
    expect(output).toContain("Application Support/opencode/opencode.db");
    expect(output).toContain("Claude Code");
    expect(output).toContain("$XDG_CONFIG_HOME/claude");
    expect(output).toContain("Codex");
    expect(output).toContain("$XDG_CONFIG_HOME/codex");
    expect(output).toContain("Pi");
    expect(output).toContain("$XDG_DATA_HOME/pi/agent/sessions");
    expect(output).toContain("--verbose");
    expect(output).toContain("--claude");
  });
  it("caps heatmap weeks to fit narrow terminals", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 12));
    Object.defineProperty(process.stdout, "columns", { value: 60, writable: true });

    const output = render(makeStats({
      agents: [makeAgent({
        totalTokens: 100,
        dailyActivity: [{ date: "2026-06-01", tokens: 100, turns: 1, cost: 0 }],
      })],
      allTimeTokens: 100,
    }), { weeks: 53 });

    expect(output).toContain("Vibe-o-meter");
    const lines = output.split("\n");
    const dataLines = lines.filter((l) => l.includes("\u25A0") || l.includes("\u2591"));
    for (const line of dataLines) {
      const visible = line.replace(/\x1b\[[0-9;]*m/g, "");
      expect(visible.length).toBeLessThanOrEqual(62);
    }
  });

  it("adapts stats bar width for narrow terminals", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, writable: true });

    const output = render(makeStats({
      agents: [makeAgent({
        harness: "opencode",
        totalTokens: 5000,
        activeDays: 42,
        longestStreak: 7,
        bestDay: { date: "2026-06-01", tokens: 2000 },
        dailyActivity: [{ date: "2026-06-01", tokens: 5000, turns: 5, cost: 0 }],
      })],
      allTimeTokens: 5000,
      allTimeActiveDays: 42,
    }), { weeks: 8 });

    expect(output).not.toContain("Less");
    expect(output).not.toContain("More");
    expect(output).not.toContain("peak");
  });

  it("shows full stats on wide terminals", () => {
    Object.defineProperty(process.stdout, "columns", { value: 120, writable: true });

    const output = render(makeStats({
      agents: [makeAgent({
        harness: "opencode",
        totalTokens: 5000,
        activeDays: 42,
        longestStreak: 7,
        bestDay: { date: "2026-06-01", tokens: 2000 },
        dailyActivity: [{ date: "2026-06-01", tokens: 5000, turns: 5, cost: 0 }],
      })],
      allTimeTokens: 5000,
      allTimeActiveDays: 42,
    }), { weeks: 8 });

    expect(output).toContain("Less");
    expect(output).toContain("More");
    expect(output).toContain("peak");
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

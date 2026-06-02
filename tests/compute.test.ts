import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateDaily, buildCombined, computeStreaks, filterTimeRange } from "../src/compute";
import type { AgentStats } from "../src/types";

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
  vi.useRealTimers();
});

describe("computeStreaks", () => {
  it("computes current and longest streaks from token-active days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 12));

    expect(
      computeStreaks([
        { date: "2026-05-27", tokens: 10, turns: 1, cost: 0 },
        { date: "2026-05-28", tokens: 20, turns: 1, cost: 0 },
        { date: "2026-05-31", tokens: 30, turns: 1, cost: 0 },
        { date: "2026-06-01", tokens: 40, turns: 1, cost: 0 },
        { date: "2026-06-02", tokens: 50, turns: 1, cost: 0 },
      ])
    ).toEqual({ currentStreak: 3, longestStreak: 3 });
  });

  it("returns zero streaks when no day has tokens", () => {
    expect(
      computeStreaks([
        { date: "2026-06-01", tokens: 0, turns: 3, cost: 0 },
      ])
    ).toEqual({ currentStreak: 0, longestStreak: 0 });
  });
});

describe("aggregateDaily", () => {
  it("sums overlapping daily activity and sorts by date", () => {
    const result = aggregateDaily([
      makeAgent({
        dailyActivity: [
          { date: "2026-06-02", tokens: 200, turns: 2, cost: 0.2 },
          { date: "2026-06-01", tokens: 100, turns: 1, cost: 0.1 },
        ],
      }),
      makeAgent({
        dailyActivity: [
          { date: "2026-06-02", tokens: 50, turns: 3, cost: 0.05 },
        ],
      }),
    ]);

    expect(result).toEqual([
      { date: "2026-06-01", tokens: 100, turns: 1, cost: 0.1 },
      { date: "2026-06-02", tokens: 250, turns: 5, cost: 0.25 },
    ]);
  });
});

describe("filterTimeRange", () => {
  it("filters to the rendered heatmap range and clears all-time-only breakdowns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 12));

    const [agent] = filterTimeRange([
      makeAgent({
        totalTokens: 600,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalCacheTokens: 30,
        totalCost: 0.6,
        totalTurns: 6,
        totalSessions: 3,
        dailyActivity: [
          { date: "2026-05-30", tokens: 100, turns: 1, cost: 0.1 },
          { date: "2026-05-31", tokens: 200, turns: 2, cost: 0.2 },
          { date: "2026-06-01", tokens: 300, turns: 3, cost: 0.3 },
        ],
        modelActivity: [{ model: "sonnet", harness: "claude", tokens: 600, inputTokens: 10, outputTokens: 20, cacheTokens: 30, cost: 0.6 }],
        projectActivity: [{ project: "/repo", harness: "claude", tokens: 600 }],
        hourlyActivity: [{ hour: 9, tokens: 600, turns: 6 }],
      }),
    ], 1);

    expect(agent.dailyActivity.map((day) => day.date)).toEqual(["2026-05-31", "2026-06-01"]);
    expect(agent.totalTokens).toBe(500);
    expect(agent.totalTurns).toBe(5);
    expect(agent.totalCost).toBe(0.5);
    expect(agent.activeDays).toBe(2);
    expect(agent.bestDay).toEqual({ date: "2026-06-01", tokens: 300, turns: 3, cost: 0.3 });
    expect(agent.totalInputTokens).toBe(0);
    expect(agent.totalOutputTokens).toBe(0);
    expect(agent.totalCacheTokens).toBe(0);
    expect(agent.totalSessions).toBe(0);
    expect(agent.modelActivity).toEqual([]);
    expect(agent.projectActivity).toEqual([]);
    expect(agent.hourlyActivity).toEqual([]);
  });
});

describe("buildCombined", () => {
  it("aggregates agent totals and unique active dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 12));

    const result = buildCombined([
      makeAgent({
        harness: "claude",
        totalTokens: 100,
        totalCost: 0.1,
        dailyActivity: [
          { date: "2026-06-01", tokens: 100, turns: 1, cost: 0.1 },
        ],
      }),
      makeAgent({
        harness: "pi",
        totalTokens: 250,
        totalCost: 0.25,
        dailyActivity: [
          { date: "2026-06-01", tokens: 50, turns: 1, cost: 0.05 },
          { date: "2026-06-02", tokens: 200, turns: 2, cost: 0.2 },
        ],
      }),
    ]);

    expect(result.allTimeTokens).toBe(350);
    expect(result.allTimeCost).toBe(0.35);
    expect(result.allTimeActiveDays).toBe(2);
    expect(result.combinedDaily).toEqual([
      { date: "2026-06-01", tokens: 150, turns: 2, cost: 0.15000000000000002 },
      { date: "2026-06-02", tokens: 200, turns: 2, cost: 0.2 },
    ]);
    expect(result.agents[1].currentStreak).toBe(2);
    expect(result.agents[1].longestStreak).toBe(2);
  });
});

import type { DailyActivity, AgentStats, CombinedStats } from "./types";
import { formatDateLocal } from "./render/format";

export function computeStreaks(daily: DailyActivity[]): {
  currentStreak: number;
  longestStreak: number;
} {
  if (daily.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const activeDates = new Set(daily.filter((d) => d.tokens > 0).map((d) => d.date));
  if (activeDates.size === 0) return { currentStreak: 0, longestStreak: 0 };

  const today = new Date();
  const todayStr = formatDateLocal(today);

  let currentStreak = 0;
  const d = new Date(today);
  while (true) {
    const ds = formatDateLocal(d);
    if (activeDates.has(ds)) {
      currentStreak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  const sorted = Array.from(activeDates).sort();
  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (diffDays === 1) {
      run++;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 1;
    }
  }
  longestStreak = Math.max(longestStreak, run);

  return { currentStreak, longestStreak };
}

export function computeAgentStreaks(agent: AgentStats): AgentStats {
  const { currentStreak, longestStreak } = computeStreaks(agent.dailyActivity);
  return { ...agent, currentStreak, longestStreak };
}

export function aggregateDaily(agents: AgentStats[]): DailyActivity[] {
  const map = new Map<string, DailyActivity>();
  for (const agent of agents) {
    for (const d of agent.dailyActivity) {
      const existing = map.get(d.date);
      if (existing) {
        existing.tokens += d.tokens;
        existing.turns += d.turns;
        existing.cost += d.cost;
      } else {
        map.set(d.date, { ...d });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function filterTimeRange(
  agents: AgentStats[],
  weeks: number
): AgentStats[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const cutoffStr = formatDateLocal(cutoff);

  return agents.map((agent) => ({
    ...agent,
    dailyActivity: agent.dailyActivity.filter((d) => d.date >= cutoffStr),
  }));
}

export function filterByModel(agents: AgentStats[], modelQuery: string): AgentStats[] {
  const needle = modelQuery.toLowerCase();
  const result: AgentStats[] = [];
  for (const agent of agents) {
    const matching = agent.modelActivity.filter((m) => m.model.toLowerCase().includes(needle));
    if (matching.length === 0) continue;
    const totalTokens = matching.reduce((s, m) => s + m.tokens, 0);
    const totalInputTokens = matching.reduce((s, m) => s + m.inputTokens, 0);
    const totalOutputTokens = matching.reduce((s, m) => s + m.outputTokens, 0);
    const totalCacheTokens = matching.reduce((s, m) => s + m.cacheTokens, 0);
    const totalCost = matching.reduce((s, m) => s + m.cost, 0);
    result.push({
      ...agent,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCacheTokens,
      totalCost,
      modelActivity: matching,
      projectActivity: [],
      dailyActivity: [],
      hourlyActivity: [],
      activeDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      bestDay: { date: "", tokens: 0 },
    });
  }
  return result;
}

export function buildCombined(agents: AgentStats[]): CombinedStats {
  const streaked = agents.map(computeAgentStreaks);
  const combinedDaily = aggregateDaily(streaked);
  const allTimeTokens = streaked.reduce((s, a) => s + a.totalTokens, 0);
  const allTimeCost = streaked.reduce((s, a) => s + a.totalCost, 0);

  const allTimeActiveDays = new Set(streaked.flatMap((a) => a.dailyActivity.map((d) => d.date))).size;

  return {
    agents: streaked,
    combinedDaily,
    allTimeTokens,
    allTimeCost,
    allTimeActiveDays,
  };
}

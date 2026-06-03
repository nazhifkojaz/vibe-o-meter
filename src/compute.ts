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
  const cutoffStr = formatDateLocal(getHeatmapStartDate(weeks));

  return agents.map((agent) => {
    const dailyActivity = agent.dailyActivity.filter((d) => d.date >= cutoffStr);
    const isFullRange = dailyActivity.length === agent.dailyActivity.length;
    let totalTokens = 0;
    let totalCost = 0;
    let totalTurns = 0;
    let activeDays = 0;
    let bestDay = { date: "", tokens: 0 };

    for (const day of dailyActivity) {
      totalTokens += day.tokens;
      totalCost += day.cost;
      totalTurns += day.turns;
      if (day.tokens > 0 || day.turns > 0) activeDays++;
      if (day.tokens > bestDay.tokens) bestDay = day;
    }

    return {
      ...agent,
      totalTokens,
      totalInputTokens: isFullRange ? agent.totalInputTokens : 0,
      totalOutputTokens: isFullRange ? agent.totalOutputTokens : 0,
      totalCacheTokens: isFullRange ? agent.totalCacheTokens : 0,
      totalCost,
      totalTurns,
      totalSessions: isFullRange ? agent.totalSessions : 0,
      activeDays,
      bestDay,
      dailyActivity,
      modelActivity: isFullRange ? agent.modelActivity : [],
      projectActivity: isFullRange ? agent.projectActivity : [],
      hourlyActivity: isFullRange ? agent.hourlyActivity : [],
    };
  });
}

function getHeatmapStartDate(weeks: number): Date {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (weeks - 1) * 7 - today.getDay());
  return startDate;
}

export function buildCombined(agents: AgentStats[]): CombinedStats {
  const streaked = agents.map(computeAgentStreaks);
  const combinedDaily = aggregateDaily(streaked);
  const allTimeTokens = streaked.reduce((s, a) => s + a.totalTokens, 0);
  const allTimeCost = streaked.reduce((s, a) => s + a.totalCost, 0);

  const activeDates = new Set<string>();
  for (const agent of streaked) {
    for (const day of agent.dailyActivity) {
      activeDates.add(day.date);
    }
  }

  return {
    agents: streaked,
    combinedDaily,
    allTimeTokens,
    allTimeCost,
    allTimeActiveDays: activeDates.size,
  };
}

import type { DailyActivity, AgentStats, CombinedStats } from "./types";

export function computeStreaks(daily: DailyActivity[]): {
  currentStreak: number;
  longestStreak: number;
} {
  if (daily.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const activeDates = new Set(daily.filter((d) => d.tokens > 0).map((d) => d.date));
  if (activeDates.size === 0) return { currentStreak: 0, longestStreak: 0 };

  const today = new Date();
  const todayStr = formatDate(today);

  let currentStreak = 0;
  const d = new Date(today);
  while (true) {
    const ds = formatDate(d);
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

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const cutoffStr = formatDate(cutoff);

  return agents.map((agent) => ({
    ...agent,
    dailyActivity: agent.dailyActivity.filter((d) => d.date >= cutoffStr),
  }));
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

import fs from "fs";
import path from "path";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";

const DEFAULT_PATH = `${process.env.HOME}/.claude/stats-cache.json`;

interface ClaudeStatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  dailyModelTokens: Array<{
    date: string;
    tokensByModel: Record<string, number>;
  }>;
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }
  >;
  totalSessions: number;
  totalMessages: number;
  hourCounts: Record<string, number>;
  firstSessionDate: string;
}

export function parse(claudePath?: string): AgentStats | null {
  const filePath = claudePath || DEFAULT_PATH;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data: ClaudeStatsCache = JSON.parse(raw);

    const dailyTokenMap = new Map<string, number>();
    for (const entry of data.dailyModelTokens) {
      if (!entry.date) continue;
      const total = Object.values(entry.tokensByModel || {}).reduce((s, v) => s + v, 0);
      dailyTokenMap.set(entry.date, (dailyTokenMap.get(entry.date) || 0) + total);
    }

    const dailyActivityMap = new Map<string, { turns: number; sessions: number }>();
    for (const entry of data.dailyActivity) {
      dailyActivityMap.set(entry.date, {
        turns: entry.messageCount || 0,
        sessions: entry.sessionCount || 0,
      });
    }

    const allDates = new Set([...dailyTokenMap.keys(), ...dailyActivityMap.keys()]);
    const dailyActivity: DailyActivity[] = Array.from(allDates)
      .sort()
      .map((date) => ({
        date,
        tokens: dailyTokenMap.get(date) || 0,
        turns: dailyActivityMap.get(date)?.turns || 0,
        cost: 0,
      }))
      .filter((d) => d.tokens > 0 || d.turns > 0);

    const modelActivity: ModelActivity[] = Object.entries(data.modelUsage || {}).map(
      ([model, usage]) => ({
        model,
        harness: "claude" as const,
        tokens: usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheTokens: usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
        cost: usage.costUSD || 0,
      })
    );

    const utcOffset = -new Date().getTimezoneOffset() / 60;
    const realTotalTokens = modelActivity.reduce((s, m) => s + m.tokens, 0);
    const totalHourTurns = Object.values(data.hourCounts || {}).reduce((s: number, v: any) => s + v, 0);

    const hourlyActivity: HourlyActivity[] = Object.entries(data.hourCounts || {}).map(
      ([hour, count]) => ({
        hour: (parseInt(hour, 10) + utcOffset + 24) % 24,
        tokens: totalHourTurns > 0 ? Math.round((count as number / totalHourTurns) * realTotalTokens) : 0,
        turns: count as number,
      })
    );
    const dailySumFromDailyModel = dailyActivity.reduce((s, d) => s + d.tokens, 0);
    const scaleFactor = dailySumFromDailyModel > 0 ? realTotalTokens / dailySumFromDailyModel : 1;

    if (scaleFactor > 1) {
      for (const d of dailyActivity) {
        d.tokens = Math.round(d.tokens * scaleFactor);
      }
    }

    const totalCost = modelActivity.reduce((s, m) => s + m.cost, 0);
    const totalInput = modelActivity.reduce((s, m) => s + m.inputTokens, 0);
    const totalOutput = modelActivity.reduce((s, m) => s + m.outputTokens, 0);
    const totalCache = modelActivity.reduce((s, m) => s + m.cacheTokens, 0);
    const totalTurns = data.totalMessages || dailyActivity.reduce((s, d) => s + d.turns, 0);
    const totalSessions = data.totalSessions || 0;
    const activeDays = new Set([...dailyTokenMap.keys(), ...dailyActivityMap.keys()]).size;
    const bestDay = dailyActivity.reduce(
      (best, d) => (d.tokens > best.tokens ? d : best),
      { date: "", tokens: 0 }
    );

    return {
      harness: "claude",
      sourcePath: filePath,
      totalTokens: realTotalTokens,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheTokens: totalCache,
      totalCost,
      totalTurns,
      totalSessions,
      activeDays,
      currentStreak: 0,
      longestStreak: 0,
      bestDay,
      dailyActivity,
      modelActivity,
      projectActivity: [],
      hourlyActivity,
    };
  } catch {
    return null;
  }
}

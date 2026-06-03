import fs from "fs";
import os from "os";
import path from "path";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";
import { formatDateLocal } from "../render/format";

const DEFAULT_ROOT = path.join(os.homedir(), ".claude");
const DEFAULT_CACHE_PATH = path.join(DEFAULT_ROOT, "stats-cache.json");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_ROOT, "projects");

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
  longestSession?: number;
  totalSpeculationTimeSavedMs?: number;
}

interface ClaudeProjectLine {
  type?: string;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  session_id?: string;
  role?: string;
  model?: string;
  usage?: Record<string, unknown>;
  message?: {
    role?: string;
    model?: string;
    usage?: Record<string, unknown>;
  };
}

export function parse(claudePath?: string, modelFilter?: string): AgentStats | null {
  const targetPath = claudePath ? path.resolve(claudePath) : DEFAULT_ROOT;

  try {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      return parseStatsCache(targetPath, modelFilter);
    }

    if (stat.isDirectory()) {
      return parseDirectory(targetPath, modelFilter);
    }
  } catch {
    if (!claudePath) {
      if (exists(DEFAULT_PROJECTS_DIR)) {
        const jsonlStats = parseProjectLogs(DEFAULT_PROJECTS_DIR, modelFilter);
        if (jsonlStats) return jsonlStats;
      }
      const cacheStats = exists(DEFAULT_CACHE_PATH) ? parseStatsCache(DEFAULT_CACHE_PATH, modelFilter) : null;
      if (cacheStats) return cacheStats;
    }
  }

  return null;
}

function parseDirectory(targetPath: string, modelFilter?: string): AgentStats | null {
  const cachePath = path.join(targetPath, "stats-cache.json");
  const cacheStats = exists(cachePath) ? parseStatsCache(cachePath, modelFilter) : null;

  const projectDirs = targetPath === DEFAULT_ROOT
    ? [DEFAULT_PROJECTS_DIR]
    : [path.join(targetPath, "projects"), targetPath];

  let jsonlStats: AgentStats | null = null;
  for (const projectDir of unique(projectDirs)) {
    if (!exists(projectDir)) continue;
    jsonlStats = parseProjectLogs(projectDir, modelFilter);
    if (jsonlStats) break;
  }

  if (!cacheStats && !jsonlStats) return null;
  if (!cacheStats) return jsonlStats;
  if (!jsonlStats) return cacheStats;

  return jsonlStats.totalTokens >= cacheStats.totalTokens ? jsonlStats : cacheStats;
}

function parseStatsCache(filePath: string, modelFilter?: string): AgentStats | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data: ClaudeStatsCache = JSON.parse(raw);
    const needle = modelFilter?.toLowerCase();

    const dailyTokenMap = new Map<string, number>();
    for (const entry of data.dailyModelTokens) {
      if (!entry.date) continue;
      let total = 0;
      const tokensByModel = entry.tokensByModel || {};
      for (const [model, tokens] of Object.entries(tokensByModel)) {
        if (model !== "<synthetic>" && (!needle || model.toLowerCase().includes(needle))) {
          total += tokens;
        }
      }
      if (total > 0) {
        dailyTokenMap.set(entry.date, (dailyTokenMap.get(entry.date) || 0) + total);
      }
    }

    const dailyActivityMap = new Map<string, { turns: number; sessions: number }>();
    if (!needle) {
      for (const entry of data.dailyActivity) {
        dailyActivityMap.set(entry.date, {
          turns: entry.messageCount || 0,
          sessions: entry.sessionCount || 0,
        });
      }
    }

    const allDates = new Set([...dailyTokenMap.keys(), ...dailyActivityMap.keys()]);
    const dailyActivity: DailyActivity[] = Array.from(allDates)
      .sort()
      .map((date) => ({
        date,
        tokens: dailyTokenMap.get(date) || 0,
        turns: needle ? 0 : dailyActivityMap.get(date)?.turns || 0,
        cost: 0,
      }))
      .filter((d) => d.tokens > 0 || d.turns > 0);

    const modelActivity: ModelActivity[] = Object.entries(data.modelUsage || {})
      .filter(([model]) => model !== "<synthetic>" && (!needle || model.toLowerCase().includes(needle)))
      .map(
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
    if (needle && realTotalTokens === 0) {
      return null;
    }
    const totalHourTurns = Object.values(data.hourCounts || {}).reduce((s: number, v: any) => s + v, 0);

    const hourlyActivity: HourlyActivity[] = needle
      ? []
      : Object.entries(data.hourCounts || {}).map(
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
    const totalTurns = needle ? 0 : data.totalMessages || dailyActivity.reduce((s, d) => s + d.turns, 0);
    const totalSessions = needle ? 0 : data.totalSessions || 0;
    const activeDays = dailyActivity.length;
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

function parseProjectLogs(projectsDir: string, modelFilter?: string): AgentStats | null {
  const files = collectJsonlFiles(projectsDir);
  if (files.length === 0) return null;

  const needle = modelFilter?.toLowerCase();
  const dailyMap = new Map<string, { tokens: number; turns: number; cost: number }>();
  const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number; cost: number }>();
  const projectMap = new Map<string, number>();
  const hourlyMap = new Map<number, { tokens: number; turns: number }>();
  const sessions = new Set<string>();

  let totalTokens = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCache = 0;
  let totalTurns = 0;

  for (const file of files) {
    let fileMatched = false;
    const fallbackProject = projectNameFromFile(projectsDir, file);

    let lines: string[];
    try {
      lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      continue;
    }

    for (const line of lines) {
      let entry: ClaudeProjectLine;
      try {
        entry = JSON.parse(line) as ClaudeProjectLine;
      } catch {
        continue;
      }

      if (entry.type !== "assistant" && entry.message?.role !== "assistant" && entry.role !== "assistant") continue;

      const usageData = entry.message?.usage || entry.usage;
      if (!entry.timestamp || !usageData) continue;

      const model = entry.message?.model || entry.model || "unknown";
      if (model === "<synthetic>") continue;
      if (needle && !model.toLowerCase().includes(needle)) continue;

      const usage = readUsage(usageData);
      if (usage.tokens === 0) continue;

      const date = formatDateLocal(new Date(entry.timestamp));
      const hour = new Date(entry.timestamp).getHours();
      const project = normalizeProject(entry.cwd || fallbackProject);

      const daily = dailyMap.get(date) || { tokens: 0, turns: 0, cost: 0 };
      daily.tokens += usage.tokens;
      daily.turns += 1;
      dailyMap.set(date, daily);

      const modelEntry = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0, cost: 0 };
      modelEntry.tokens += usage.tokens;
      modelEntry.input += usage.inputTokens;
      modelEntry.output += usage.outputTokens;
      modelEntry.cache += usage.cacheTokens;
      modelMap.set(model, modelEntry);

      projectMap.set(project, (projectMap.get(project) || 0) + usage.tokens);

      const hourly = hourlyMap.get(hour) || { tokens: 0, turns: 0 };
      hourly.tokens += usage.tokens;
      hourly.turns += 1;
      hourlyMap.set(hour, hourly);

      totalTokens += usage.tokens;
      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;
      totalCache += usage.cacheTokens;
      totalTurns += 1;
      fileMatched = true;

      const sessionId = entry.sessionId || entry.session_id;
      if (sessionId) sessions.add(sessionId);
    }

    if (fileMatched && sessions.size === 0) {
      sessions.add(file);
    }
  }

  if (totalTokens === 0) return null;

  const dailyActivity: DailyActivity[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.turns, cost: v.cost }));

  const modelActivity: ModelActivity[] = Array.from(modelMap.entries())
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([model, v]) => ({
      model,
      harness: "claude" as const,
      tokens: v.tokens,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheTokens: v.cache,
      cost: v.cost,
    }));

  const projectActivity: ProjectActivity[] = Array.from(projectMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([project, tokens]) => ({ project, harness: "claude" as const, tokens }));

  const hourlyActivity: HourlyActivity[] = Array.from(hourlyMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.turns }));

  const activeDays = dailyActivity.length;
  const bestDay = dailyActivity.reduce(
    (best, d) => (d.tokens > best.tokens ? d : best),
    { date: "", tokens: 0 }
  );

  return {
    harness: "claude",
    sourcePath: projectsDir,
    totalTokens,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheTokens: totalCache,
    totalCost: 0,
    totalTurns,
    totalSessions: sessions.size,
    activeDays,
    currentStreak: 0,
    longestStreak: 0,
    bestDay,
    dailyActivity,
    modelActivity,
    projectActivity,
    hourlyActivity,
  };
}

function collectJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectJsonlFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  } catch {}
  return files;
}

function readUsage(usage: Record<string, unknown>): {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  reasoningTokens: number;
} {
  const inputTokens = readNumber(usage.input_tokens) || readNumber(usage.inputTokens);
  const outputTokens = readNumber(usage.output_tokens) || readNumber(usage.outputTokens);
  const cacheTokens =
    readNumber(usage.cache_read_input_tokens) +
    readNumber(usage.cache_creation_input_tokens) +
    readNumber(usage.cacheReadInputTokens) +
    readNumber(usage.cacheCreationInputTokens);
  const reasoningTokens = readNumber(usage.reasoning_output_tokens) || readNumber(usage.reasoningOutputTokens);
  const computedTokens = inputTokens + outputTokens + cacheTokens + reasoningTokens;
  const explicitTokens = readNumber(usage.total_tokens) || readNumber(usage.totalTokens);

  return {
    tokens: computedTokens || explicitTokens,
    inputTokens,
    outputTokens,
    cacheTokens,
    reasoningTokens,
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function projectNameFromFile(projectsDir: string, filePath: string): string {
  const [project] = path.relative(projectsDir, filePath).split(path.sep);
  return project || "(unknown)";
}

function normalizeProject(project: string): string {
  return project === "/" ? "(global)" : project;
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

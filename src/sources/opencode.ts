import os from "os";
import path from "path";
import { Database, queryAll } from "./sqlite";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

interface MessageActivitySummary {
  dailyActivity: DailyActivity[];
  modelActivity: ModelActivity[];
  hourlyActivity: HourlyActivity[];
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  totalCost: number;
  totalTurns: number;
  totalSessions: number;
}

export function parse(dbPath?: string, modelFilter?: string): AgentStats | null {
  const path = dbPath || DEFAULT_DB_PATH;
  try {
    const db = new Database(path, { readonly: true });
    const needle = modelFilter?.toLowerCase();
    const hasSessionId = hasColumn(db, "message", "session_id");

    let dailyActivity: DailyActivity[] = [];
    let projectActivity: ProjectActivity[] = [];
    let hourlyActivity: HourlyActivity[] = [];
    let modelActivity: ModelActivity[] = [];
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCache = 0;
    let totalCost = 0;
    let totalTurns = 0;
    let totalSessions = 0;

    if (needle) {
      const fromMessages = readMessageActivity(db, needle, hasSessionId);
      dailyActivity = fromMessages.dailyActivity;
      modelActivity = fromMessages.modelActivity;
      hourlyActivity = fromMessages.hourlyActivity;
      totalTokens = fromMessages.totalTokens;
      totalInput = fromMessages.totalInput;
      totalOutput = fromMessages.totalOutput;
      totalCache = fromMessages.totalCache;
      totalCost = fromMessages.totalCost;
      totalTurns = fromMessages.totalTurns;
      totalSessions = fromMessages.totalSessions;
      projectActivity = [];
    } else {
      try {
        const fromSessions = readSessionActivity(db);
        dailyActivity = fromSessions.dailyActivity;
        projectActivity = fromSessions.projectActivity;
        hourlyActivity = fromSessions.hourlyActivity;
        totalTokens = fromSessions.totalTokens;
        totalInput = fromSessions.totalInput;
        totalOutput = fromSessions.totalOutput;
        totalCache = fromSessions.totalCache;
        totalCost = fromSessions.totalCost;
        totalTurns = fromSessions.totalTurns;
        totalSessions = fromSessions.totalSessions;
      } catch {}

      const fromMessages = readMessageActivity(db, undefined, hasSessionId);
      modelActivity = fromMessages.modelActivity;

      if (totalTokens === 0 && fromMessages.totalTokens > 0) {
        dailyActivity = fromMessages.dailyActivity;
        hourlyActivity = fromMessages.hourlyActivity;
        totalTokens = fromMessages.totalTokens;
        totalInput = fromMessages.totalInput;
        totalOutput = fromMessages.totalOutput;
        totalCache = fromMessages.totalCache;
        totalCost = fromMessages.totalCost;
        totalTurns = fromMessages.totalTurns;
        totalSessions = fromMessages.totalSessions;
      }
    }

    db.close();

    if (needle && totalTokens === 0) {
      return null;
    }

    const activeDays = dailyActivity.length;
    const bestDay = dailyActivity.reduce(
      (best, d) => (d.tokens > best.tokens ? d : best),
      { date: "", tokens: 0 }
    );

    return {
      harness: "opencode",
      sourcePath: path,
      totalTokens,
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
      projectActivity,
      hourlyActivity,
    };
  } catch {
    return null;
  }
}

function readSessionActivity(db: any): {
  dailyActivity: DailyActivity[];
  projectActivity: ProjectActivity[];
  hourlyActivity: HourlyActivity[];
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  totalCost: number;
  totalTurns: number;
  totalSessions: number;
} {
  const sessions = queryAll(db, `
    SELECT
      DATE(time_created / 1000, 'unixepoch', 'localtime') as date,
      SUM(tokens_input) as input_tokens,
      SUM(tokens_output) as output_tokens,
      SUM(tokens_cache_read + tokens_cache_write) as cache_tokens,
      SUM(tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write) as tokens,
      SUM(cost) as cost,
      COUNT(*) as session_count
    FROM session
    GROUP BY date
    ORDER BY date
  `) as any[];

  const projectRows = queryAll(db, `
    SELECT
      directory as project,
      SUM(tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write) as tokens
    FROM session
    GROUP BY project
    ORDER BY tokens DESC
  `) as any[];

  const hourlyRows = queryAll(db, `
    SELECT
      CAST(STRFTIME('%H', time_created / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
      SUM(tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write) as tokens,
      COUNT(*) as turns
    FROM session
    GROUP BY hour
    ORDER BY hour
  `) as any[];

  const dailyActivity = sessions
    .filter((r: any) => r.date && r.tokens > 0)
    .map((r: any) => ({
      date: r.date,
      tokens: r.tokens,
      turns: r.session_count,
      cost: r.cost || 0,
    }));

  const projectActivity = projectRows
    .filter((r: any) => r.project && r.tokens > 0)
    .map((r: any) => ({
      project: r.project === "/" ? "(global)" : r.project,
      harness: "opencode" as const,
      tokens: r.tokens,
    }));

  const hourlyActivity = hourlyRows.map((r: any) => ({
    hour: r.hour,
    tokens: r.tokens,
    turns: r.turns,
  }));

  return {
    dailyActivity,
    projectActivity,
    hourlyActivity,
    totalTokens: dailyActivity.reduce((s, d) => s + d.tokens, 0),
    totalInput: sessions.reduce((s: number, r: any) => s + (r.input_tokens || 0), 0),
    totalOutput: sessions.reduce((s: number, r: any) => s + (r.output_tokens || 0), 0),
    totalCache: sessions.reduce((s: number, r: any) => s + (r.cache_tokens || 0), 0),
    totalCost: dailyActivity.reduce((s, d) => s + d.cost, 0),
    totalTurns: dailyActivity.reduce((s, d) => s + d.turns, 0),
    totalSessions: sessions.reduce((s: number, r: any) => s + (r.session_count || 0), 0),
  };
}

function readMessageActivity(db: any, modelFilter?: string, hasSessionId = false): MessageActivitySummary {
  const sessionIdColumn = hasSessionId ? "session_id" : "NULL as session_id";
  const rows = queryAll(db, `
    SELECT
      COALESCE(CAST(json_extract(data, '$.time.created') AS INTEGER), time_created) as time_ms,
      data,
      ${sessionIdColumn}
    FROM message
    WHERE data LIKE '%"tokens"%'
  `) as any[];

  const needle = modelFilter?.toLowerCase();
  const dailyMap = new Map<string, { tokens: number; turns: number; cost: number }>();
  const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number; cost: number }>();
  const hourlyMap = new Map<number, { tokens: number; turns: number }>();
  const sessionIds = new Set<string>();

  let totalTokens = 0;
  let totalTurns = 0;

  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      if (d.role !== "assistant" || !d.tokens) continue;

      const model = d.modelID || "unknown";
      if (needle && !model.toLowerCase().includes(needle)) continue;

      const t = d.tokens;
      const tokens = (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);
      if (tokens === 0) continue;

      const time = normalizeTimestamp(row.time_ms || d.time?.created || Date.now());
      const date = formatDateUTC(time);
      const hour = time.getHours();

      const daily = dailyMap.get(date) || { tokens: 0, turns: 0, cost: 0 };
      daily.tokens += tokens;
      daily.turns += 1;
      daily.cost += d.cost || 0;
      dailyMap.set(date, daily);

      const modelEntry = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0, cost: 0 };
      modelEntry.tokens += tokens;
      modelEntry.input += t.input || 0;
      modelEntry.output += t.output || 0;
      modelEntry.cache += (t.cache?.read || 0) + (t.cache?.write || 0);
      modelEntry.cost += d.cost || 0;
      modelMap.set(model, modelEntry);

      const hourly = hourlyMap.get(hour) || { tokens: 0, turns: 0 };
      hourly.tokens += tokens;
      hourly.turns += 1;
      hourlyMap.set(hour, hourly);

      if (row.session_id !== null && row.session_id !== undefined && row.session_id !== "") {
        sessionIds.add(String(row.session_id));
      }
      totalTokens += tokens;
      totalTurns += 1;
    } catch {}
  }

  const dailyActivity = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.turns, cost: v.cost }));

  const modelActivity = Array.from(modelMap.entries()).map(([model, v]) => ({
    model,
    harness: "opencode" as const,
    tokens: v.tokens,
    inputTokens: v.input,
    outputTokens: v.output,
    cacheTokens: v.cache,
    cost: v.cost,
  }));

  const hourlyActivity = Array.from(hourlyMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.turns }));

  return {
    dailyActivity,
    modelActivity,
    hourlyActivity,
    totalTokens,
    totalInput: modelActivity.reduce((s, m) => s + m.inputTokens, 0),
    totalOutput: modelActivity.reduce((s, m) => s + m.outputTokens, 0),
    totalCache: modelActivity.reduce((s, m) => s + m.cacheTokens, 0),
    totalCost: modelActivity.reduce((s, m) => s + m.cost, 0),
    totalTurns,
    totalSessions: sessionIds.size || totalTurns,
  };
}

function normalizeTimestamp(value: number): Date {
  return new Date(value < 1_000_000_000_000 ? value * 1000 : value);
}

function formatDateUTC(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hasColumn(db: any, tableName: string, columnName: string): boolean {
  try {
    const columns = queryAll(db, `PRAGMA table_info(${tableName})`) as Array<{ name?: string }>;
    return columns.some((column) => column.name === columnName);
  } catch {
    return false;
  }
}

function countDistinctSessionIds(rows: any[]): number {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.session_id !== null && row.session_id !== undefined && row.session_id !== "") {
      ids.add(String(row.session_id));
    }
  }
  return ids.size;
}

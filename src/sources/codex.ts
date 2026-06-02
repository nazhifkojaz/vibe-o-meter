import { Database, queryAll } from "./sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";
import { formatDateLocal } from "../render/format";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".codex", "state_5.sqlite");
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

interface RolloutTokens {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

interface CodexPaths {
  dbFile: string;
  sessionsDir: string;
  sourcePath: string;
}

interface RolloutSummary {
  usage: RolloutTokens;
  timestamp: string | null;
  model: string;
  project: string;
}

function getLastTokenCount(filePath: string): RolloutTokens | null {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (
          obj.type === "event_msg" &&
          obj.payload?.type === "token_count" &&
          obj.payload?.info?.total_token_usage
        ) {
          const u = obj.payload.info.total_token_usage;
          return {
            inputTokens: u.input_tokens || 0,
            outputTokens: u.output_tokens || 0,
            cachedTokens: u.cached_input_tokens || 0,
            reasoningTokens: u.reasoning_output_tokens || 0,
            totalTokens: (u.input_tokens || 0) + (u.cached_input_tokens || 0) + (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
          };
        }
      } catch {}
    }
  } catch {}
  return null;
}

function findRolloutForThread(sessionsDir: string, threadId: string): string | null {
  try {
    const years = fs.readdirSync(sessionsDir);
    for (const year of years) {
      const yearDir = path.join(sessionsDir, year);
      if (!fs.statSync(yearDir).isDirectory()) continue;
      const months = fs.readdirSync(yearDir);
      for (const month of months) {
        const monthDir = path.join(yearDir, month);
        if (!fs.statSync(monthDir).isDirectory()) continue;
        const days = fs.readdirSync(monthDir);
        for (const day of days) {
          const dayDir = path.join(monthDir, day);
          if (!fs.statSync(dayDir).isDirectory()) continue;
          const files = fs.readdirSync(dayDir);
          for (const file of files) {
            if (file.includes(threadId)) {
              return path.join(dayDir, file);
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

export function parse(dbPath?: string, sessionsDir?: string, modelFilter?: string): AgentStats | null {
  const paths = resolveCodexPaths(dbPath, sessionsDir);
  const dbFile = paths.dbFile;
  const sessDir = paths.sessionsDir;
  try {
    const db = new Database(dbFile, { readonly: true });

    const threads = queryAll(db, `
      SELECT
        id,
        COALESCE(model, 'unknown') as model,
        COALESCE(cwd, '(unknown)') as project,
        tokens_used,
        updated_at_ms
      FROM threads
      WHERE tokens_used > 0 OR updated_at_ms IS NOT NULL
      ORDER BY updated_at_ms
    `) as any[];

    db.close();

    const needle = modelFilter?.toLowerCase();

    const dailyMap = new Map<string, { tokens: number; sessions: number }>();
    const modelMap = new Map<string, { tokens: number; count: number }>();
    const projectMap = new Map<string, number>();
    const hourlyMap = new Map<number, { tokens: number; sessions: number }>();
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCache = 0;
    let totalSessions = 0;

    for (const thread of threads) {
      if (!thread.updated_at_ms) continue;

      const threadModel = (thread.model || "unknown").toLowerCase();
      if (needle && !threadModel.includes(needle)) continue;

      const rolloutPath = findRolloutForThread(sessDir, thread.id);
      let tokens: number;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheTokens = 0;

      if (rolloutPath) {
        const usage = getLastTokenCount(rolloutPath);
        if (usage && usage.totalTokens > 0) {
          tokens = usage.totalTokens;
          inputTokens = usage.inputTokens;
          outputTokens = usage.outputTokens;
          cacheTokens = usage.cachedTokens;
        } else {
          tokens = thread.tokens_used || 0;
        }
      } else {
        tokens = thread.tokens_used || 0;
      }

      if (tokens === 0) continue;
      totalTokens += tokens;
      totalInput += inputTokens;
      totalOutput += outputTokens;
      totalCache += cacheTokens;
      totalSessions++;

      const date = formatDateLocal(new Date(thread.updated_at_ms));
      const d = dailyMap.get(date) || { tokens: 0, sessions: 0 };
      d.tokens += tokens;
      d.sessions += 1;
      dailyMap.set(date, d);

      const model = thread.model || "unknown";
      const mv = modelMap.get(model) || { tokens: 0, count: 0 };
      mv.tokens += tokens;
      mv.count += 1;
      modelMap.set(model, mv);

      const project = thread.project === "/" ? "(global)" : thread.project;
      projectMap.set(project, (projectMap.get(project) || 0) + tokens);

      const hour = new Date(thread.updated_at_ms).getHours();
      const hv = hourlyMap.get(hour) || { tokens: 0, sessions: 0 };
      hv.tokens += tokens;
      hv.sessions += 1;
      hourlyMap.set(hour, hv);
    }

    const dailyActivity: DailyActivity[] = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.sessions, cost: 0 }));

    const modelActivity: ModelActivity[] = Array.from(modelMap.entries())
      .sort(([, a], [, b]) => b.tokens - a.tokens)
      .map(([model, v]) => ({
        model,
        harness: "codex" as const,
        tokens: v.tokens,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        cost: 0,
      }));

    const projectActivity: ProjectActivity[] = Array.from(projectMap.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([project, tokens]) => ({ project, harness: "codex" as const, tokens }));

    const hourlyActivity: HourlyActivity[] = Array.from(hourlyMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.sessions }));

    const activeDays = dailyActivity.length;
    const bestDay = dailyActivity.reduce(
      (best, d) => (d.tokens > best.tokens ? d : best),
      { date: "", tokens: 0 }
    );

    if (totalTokens === 0) {
      const fallback = parseSessionRollouts(sessDir, modelFilter, paths.sourcePath);
      if (fallback) return fallback;
    }

    if (needle && totalTokens === 0) {
      return null;
    }

    return {
      harness: "codex",
      sourcePath: paths.sourcePath,
      totalTokens,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheTokens: totalCache,
      totalCost: 0,
      totalTurns: totalSessions,
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
    return parseSessionRollouts(sessDir, modelFilter, paths.sourcePath);
  }
}

function resolveCodexPaths(dataPath?: string, sessionsDir?: string): CodexPaths {
  if (!dataPath) {
    return {
      dbFile: DEFAULT_DB_PATH,
      sessionsDir: sessionsDir || DEFAULT_SESSIONS_DIR,
      sourcePath: DEFAULT_DB_PATH,
    };
  }

  try {
    if (fs.statSync(dataPath).isDirectory()) {
      const isSessionsDir = path.basename(dataPath) === "sessions";
      return {
        dbFile: isSessionsDir ? path.join(path.dirname(dataPath), "state_5.sqlite") : path.join(dataPath, "state_5.sqlite"),
        sessionsDir: sessionsDir || (isSessionsDir ? dataPath : path.join(dataPath, "sessions")),
        sourcePath: dataPath,
      };
    }
  } catch {}

  return {
    dbFile: dataPath,
    sessionsDir: sessionsDir || DEFAULT_SESSIONS_DIR,
    sourcePath: dataPath,
  };
}

function parseSessionRollouts(sessionsDir: string, modelFilter?: string, sourcePath = sessionsDir): AgentStats | null {
  const files = collectRolloutFiles(sessionsDir);
  if (files.length === 0) return null;

  const needle = modelFilter?.toLowerCase();
  const dailyMap = new Map<string, { tokens: number; sessions: number }>();
  const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number }>();
  const projectMap = new Map<string, number>();
  const hourlyMap = new Map<number, { tokens: number; sessions: number }>();

  let totalTokens = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCache = 0;
  let totalSessions = 0;

  for (const file of files) {
    const rollout = readRolloutSummary(file);
    if (!rollout || rollout.usage.totalTokens === 0) continue;
    if (needle && !rollout.model.toLowerCase().includes(needle)) continue;

    const timestamp = rollout.timestamp ? new Date(rollout.timestamp) : fs.statSync(file).mtime;
    const date = formatDateLocal(timestamp);
    const hour = timestamp.getHours();
    const model = rollout.model;
    const project = rollout.project === "/" ? "(global)" : rollout.project;
    const usage = rollout.usage;

    const daily = dailyMap.get(date) || { tokens: 0, sessions: 0 };
    daily.tokens += usage.totalTokens;
    daily.sessions += 1;
    dailyMap.set(date, daily);

    const modelEntry = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0 };
    modelEntry.tokens += usage.totalTokens;
    modelEntry.input += usage.inputTokens;
    modelEntry.output += usage.outputTokens;
    modelEntry.cache += usage.cachedTokens;
    modelMap.set(model, modelEntry);

    projectMap.set(project, (projectMap.get(project) || 0) + usage.totalTokens);

    const hourly = hourlyMap.get(hour) || { tokens: 0, sessions: 0 };
    hourly.tokens += usage.totalTokens;
    hourly.sessions += 1;
    hourlyMap.set(hour, hourly);

    totalTokens += usage.totalTokens;
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    totalCache += usage.cachedTokens;
    totalSessions += 1;
  }

  if (totalTokens === 0) return null;

  const dailyActivity: DailyActivity[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.sessions, cost: 0 }));

  const modelActivity: ModelActivity[] = Array.from(modelMap.entries())
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([model, v]) => ({
      model,
      harness: "codex" as const,
      tokens: v.tokens,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheTokens: v.cache,
      cost: 0,
    }));

  const projectActivity: ProjectActivity[] = Array.from(projectMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([project, tokens]) => ({ project, harness: "codex" as const, tokens }));

  const hourlyActivity: HourlyActivity[] = Array.from(hourlyMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.sessions }));

  const bestDay = dailyActivity.reduce(
    (best, d) => (d.tokens > best.tokens ? d : best),
    { date: "", tokens: 0 }
  );

  return {
    harness: "codex",
    sourcePath,
    totalTokens,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheTokens: totalCache,
    totalCost: 0,
    totalTurns: totalSessions,
    totalSessions,
    activeDays: dailyActivity.length,
    currentStreak: 0,
    longestStreak: 0,
    bestDay,
    dailyActivity,
    modelActivity,
    projectActivity,
    hourlyActivity,
  };
}

function collectRolloutFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectRolloutFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  } catch {}
  return files;
}

function readRolloutSummary(filePath: string): RolloutSummary | null {
  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  } catch {
    return null;
  }

  let usage: RolloutTokens | null = null;
  let timestamp: string | null = null;
  let model = "unknown";
  let project = "(unknown)";

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof obj.timestamp === "string") timestamp = obj.timestamp;

    const payload = obj.payload || {};
    if (typeof obj.cwd === "string") project = obj.cwd;
    if (typeof payload.cwd === "string") project = payload.cwd;
    if (typeof obj.model === "string") model = obj.model;
    if (typeof payload.model === "string") model = payload.model;
    if (typeof payload.info?.model === "string") model = payload.info.model;

    if (obj.type === "event_msg" && payload.type === "token_count" && payload.info?.total_token_usage) {
      const parsedUsage = tokenUsageFromRaw(payload.info.total_token_usage);
      if (parsedUsage.totalTokens > 0) usage = parsedUsage;
    }
  }

  return usage ? { usage, timestamp, model, project } : null;
}

function tokenUsageFromRaw(u: any): RolloutTokens {
  return {
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cachedTokens: u.cached_input_tokens || 0,
    reasoningTokens: u.reasoning_output_tokens || 0,
    totalTokens: (u.input_tokens || 0) + (u.cached_input_tokens || 0) + (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
  };
}

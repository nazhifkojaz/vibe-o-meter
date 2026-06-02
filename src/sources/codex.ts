import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";

const DEFAULT_DB_PATH = `${process.env.HOME}/.codex/state_5.sqlite`;
const DEFAULT_SESSIONS_DIR = `${process.env.HOME}/.codex/sessions`;

interface RolloutTokens {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
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

export function parse(dbPath?: string, sessionsDir?: string): AgentStats | null {
  const dbFile = dbPath || DEFAULT_DB_PATH;
  const sessDir = sessionsDir || DEFAULT_SESSIONS_DIR;
  try {
    const db = new Database(dbFile, { readonly: true });

    const threads = db.query(`
      SELECT
        id,
        COALESCE(model, 'unknown') as model,
        COALESCE(cwd, '(unknown)') as project,
        tokens_used,
        updated_at_ms
      FROM threads
      WHERE tokens_used > 0 OR updated_at_ms IS NOT NULL
      ORDER BY updated_at_ms
    `).all() as any[];

    db.close();

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

    return {
      harness: "codex",
      sourcePath: dbFile,
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
    return null;
  }
}

function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

import { Database, queryAll } from "./sqlite";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";

const DEFAULT_DB_PATH = `${process.env.HOME}/.local/share/opencode/opencode.db`;

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
      const sessionIdColumn = hasSessionId ? "session_id" : "NULL as session_id";
      const msgRows = queryAll(db, `
        SELECT time_created, data, ${sessionIdColumn}
        FROM message
        WHERE json_extract(data, '$.role') = 'assistant'
          AND LOWER(json_extract(data, '$.modelID')) LIKE ?
      `, [`%${needle}%`]) as any[];

      const dailyMap = new Map<string, { tokens: number; turns: number; cost: number }>();
      const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number; cost: number }>();
      const hourlyMap = new Map<number, { tokens: number; turns: number }>();

      for (const row of msgRows) {
        try {
          const d = JSON.parse(row.data);
          if (!d.tokens) continue;
          const t = d.tokens;
          const tokens = (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);
          if (tokens === 0) continue;

          const model = d.modelID || "unknown";
          const date = formatDateUTC(new Date(row.time_created));
          const hour = new Date(row.time_created).getHours();

          const dm = dailyMap.get(date) || { tokens: 0, turns: 0, cost: 0 };
          dm.tokens += tokens;
          dm.turns += 1;
          dm.cost += d.cost || 0;
          dailyMap.set(date, dm);

          const mm = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0, cost: 0 };
          mm.tokens += tokens;
          mm.input += t.input || 0;
          mm.output += t.output || 0;
          mm.cache += (t.cache?.read || 0) + (t.cache?.write || 0);
          mm.cost += d.cost || 0;
          modelMap.set(model, mm);

          const hm = hourlyMap.get(hour) || { tokens: 0, turns: 0 };
          hm.tokens += tokens;
          hm.turns += 1;
          hourlyMap.set(hour, hm);

          totalTokens += tokens;
          totalTurns += 1;
        } catch {}
      }

      dailyActivity = Array.from(dailyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.turns, cost: v.cost }));

      modelActivity = Array.from(modelMap.entries()).map(([model, v]) => ({
        model,
        harness: "opencode" as const,
        tokens: v.tokens,
        inputTokens: v.input,
        outputTokens: v.output,
        cacheTokens: v.cache,
        cost: v.cost,
      }));

      hourlyActivity = Array.from(hourlyMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.turns }));

      totalInput = modelActivity.reduce((s, m) => s + m.inputTokens, 0);
      totalOutput = modelActivity.reduce((s, m) => s + m.outputTokens, 0);
      totalCache = modelActivity.reduce((s, m) => s + m.cacheTokens, 0);
      totalCost = modelActivity.reduce((s, m) => s + m.cost, 0);
      totalSessions = countDistinctSessionIds(msgRows);
      projectActivity = [];
    } else {
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
          DATE(time_created / 1000, 'unixepoch', 'localtime') as date,
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

      try {
        const msgRows = queryAll(db, `
          SELECT data
          FROM message
          WHERE data LIKE '%"tokens"%'
        `) as any[];

        const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number; cost: number }>();
        for (const row of msgRows) {
          try {
            const d = JSON.parse(row.data);
            if (d.role !== "assistant" || !d.tokens) continue;
            const model = d.modelID || "unknown";
            const t = d.tokens;
            const existing = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0, cost: 0 };
            existing.tokens += (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);
            existing.input += t.input || 0;
            existing.output += t.output || 0;
            existing.cache += (t.cache?.read || 0) + (t.cache?.write || 0);
            existing.cost += d.cost || 0;
            modelMap.set(model, existing);
          } catch {}
        }
        modelActivity = Array.from(modelMap.entries()).map(([model, v]) => ({
          model,
          harness: "opencode" as const,
          tokens: v.tokens,
          inputTokens: v.input,
          outputTokens: v.output,
          cacheTokens: v.cache,
          cost: v.cost,
        }));
      } catch {}

      dailyActivity = sessions
        .filter((r: any) => r.date && r.tokens > 0)
        .map((r: any) => ({
          date: r.date,
          tokens: r.tokens,
          turns: r.session_count,
          cost: r.cost || 0,
        }));

      projectActivity = projectRows
        .filter((r: any) => r.project && r.tokens > 0)
        .map((r: any) => ({
          project: r.project === "/" ? "(global)" : r.project,
          harness: "opencode" as const,
          tokens: r.tokens,
        }));

      hourlyActivity = hourlyRows.map((r: any) => ({
        hour: r.hour,
        tokens: r.tokens,
        turns: r.turns,
      }));

      totalTokens = dailyActivity.reduce((s, d) => s + d.tokens, 0);
      totalInput = sessions.reduce((s: number, r: any) => s + (r.input_tokens || 0), 0);
      totalOutput = sessions.reduce((s: number, r: any) => s + (r.output_tokens || 0), 0);
      totalCache = sessions.reduce((s: number, r: any) => s + (r.cache_tokens || 0), 0);
      totalCost = dailyActivity.reduce((s, d) => s + d.cost, 0);
      totalTurns = dailyActivity.reduce((s, d) => s + d.turns, 0);
      totalSessions = sessions.reduce((s: number, r: any) => s + (r.session_count || 0), 0);
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

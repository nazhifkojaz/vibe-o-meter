import { Database } from "bun:sqlite";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";

const DEFAULT_DB_PATH = `${process.env.HOME}/.local/share/opencode/opencode.db`;

export function parse(dbPath?: string): AgentStats | null {
  const path = dbPath || DEFAULT_DB_PATH;
  try {
    const db = new Database(path, { readonly: true });
    const sessions = db.query(`
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
    `).all() as any[];

    const projectRows = db.query(`
      SELECT
        DATE(time_created / 1000, 'unixepoch', 'localtime') as date,
        directory as project,
        SUM(tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write) as tokens
      FROM session
      GROUP BY project
      ORDER BY tokens DESC
    `).all() as any[];

    const hourlyRows = db.query(`
      SELECT
        CAST(STRFTIME('%H', time_created / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
        SUM(tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write) as tokens,
        COUNT(*) as turns
      FROM session
      GROUP BY hour
      ORDER BY hour
    `).all() as any[];

    let modelActivity: ModelActivity[] = [];
    try {
      const msgRows = db.query(`
        SELECT data
        FROM message
        WHERE data LIKE '%"tokens"%'
      `).all() as any[];

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

    db.close();

    const dailyActivity: DailyActivity[] = sessions
      .filter((r: any) => r.date && r.tokens > 0)
      .map((r: any) => ({
        date: r.date,
        tokens: r.tokens,
        turns: r.session_count,
        cost: r.cost || 0,
      }));

    const projectActivity: ProjectActivity[] = projectRows
      .filter((r: any) => r.project && r.tokens > 0)
      .map((r: any) => ({
        project: r.project === "/" ? "(global)" : r.project,
        harness: "opencode" as const,
        tokens: r.tokens,
      }));

    const hourlyActivity: HourlyActivity[] = hourlyRows.map((r: any) => ({
      hour: r.hour,
      tokens: r.tokens,
      turns: r.turns,
    }));

    const totalTokens = dailyActivity.reduce((s, d) => s + d.tokens, 0);
    const totalInput = sessions.reduce((s: number, r: any) => s + (r.input_tokens || 0), 0);
    const totalOutput = sessions.reduce((s: number, r: any) => s + (r.output_tokens || 0), 0);
    const totalCache = sessions.reduce((s: number, r: any) => s + (r.cache_tokens || 0), 0);
    const totalCost = dailyActivity.reduce((s, d) => s + d.cost, 0);
    const totalTurns = dailyActivity.reduce((s, d) => s + d.turns, 0);
    const totalSessions = sessions.reduce((s: number, r: any) => s + (r.session_count || 0), 0);
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

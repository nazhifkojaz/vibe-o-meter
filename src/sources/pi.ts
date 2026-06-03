import fs from "fs";
import os from "os";
import path from "path";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats } from "../types";
import { formatDateLocal } from "../render/format";
import { collectJsonlFiles } from "./files";

const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");

interface PiMessageUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

interface PiSessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

interface PiLine {
  type: string;
  role?: string;
  timestamp?: string;
  cwd?: string;
  modelId?: string;
  message?: {
    role?: string;
    model?: string;
    provider?: string;
    usage?: PiMessageUsage;
  };
}

interface AggregatedSession {
  cwd: string;
  timestamp: string;
  messages: Array<{
    model: string;
    provider: string;
    usage: PiMessageUsage;
    timestamp?: string;
  }>;
}

function parseSessionFile(filePath: string): AggregatedSession | null {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    let header: PiSessionHeader | null = null;
    const messages: AggregatedSession["messages"] = [];
    let currentModel = "unknown";
    let currentProvider = "unknown";
    let firstTimestamp = "";

    for (const line of lines) {
      try {
        const obj: PiLine = JSON.parse(line);
        if (obj.timestamp && !firstTimestamp) {
          firstTimestamp = obj.timestamp;
        }
        if (obj.type === "session" && obj.timestamp && obj.cwd !== undefined) {
          header = obj as unknown as PiSessionHeader;
        }
        if (obj.type === "model_change" && obj.modelId) {
          currentModel = obj.modelId;
        }
        if (obj.type === "message" && obj.message) {
          const msg = obj.message;
          if (msg.role && msg.role !== "assistant") continue;
          const totalTokens = getUsageTotal(msg.usage);
          if (totalTokens > 0) {
            if (msg.model) currentModel = msg.model;
            if (msg.provider) currentProvider = msg.provider;
            messages.push({
              model: msg.model || currentModel,
              provider: msg.provider || currentProvider,
              usage: { ...msg.usage, totalTokens },
              timestamp: obj.timestamp,
            });
          }
        }
      } catch {}
    }

    if (!header && messages.length === 0) return null;
    return {
      cwd: header?.cwd ?? projectNameFromFile(filePath),
      timestamp: header?.timestamp ?? firstTimestamp,
      messages,
    };
  } catch {
    return null;
  }
}

export function parse(sessionsDir?: string, modelFilter?: string): AgentStats | null {
  const dir = sessionsDir || DEFAULT_SESSIONS_DIR;
  try {
    if (!fs.existsSync(dir)) return null;
    const files = collectJsonlFiles(dir);
    if (files.length === 0) return null;

    const dailyMap = new Map<string, { tokens: number; turns: number; cost: number }>();
    const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number; cost: number }>();
    const projectMap = new Map<string, number>();
    const hourlyMap = new Map<number, { tokens: number; turns: number }>();
    let totalSessions = 0;
    const needle = modelFilter?.toLowerCase();

    for (const file of files) {
      const session = parseSessionFile(file);
      if (!session || session.messages.length === 0) continue;

      let sessionMatched = false;

      for (const msg of session.messages) {
        if (needle && !(msg.model || "unknown").toLowerCase().includes(needle)) continue;
        sessionMatched = true;

        const timestamp = msg.timestamp || session.timestamp;
        const date = formatDateLocal(new Date(timestamp));
        const d = dailyMap.get(date) || { tokens: 0, turns: 0, cost: 0 };
        const totalTokens = getUsageTotal(msg.usage);
        d.tokens += totalTokens;
        d.turns += 1;
        d.cost += getUsageCost(msg.usage);
        dailyMap.set(date, d);

        const mk = msg.model;
        const mv = modelMap.get(mk) || { tokens: 0, input: 0, output: 0, cache: 0, cost: 0 };
        mv.tokens += totalTokens;
        mv.input += tokenCount(msg.usage.input);
        mv.output += tokenCount(msg.usage.output);
        mv.cache += tokenCount(msg.usage.cacheRead) + tokenCount(msg.usage.cacheWrite);
        mv.cost += getUsageCost(msg.usage);
        modelMap.set(mk, mv);

        const project = session.cwd === "/" ? "(global)" : session.cwd;
        projectMap.set(project, (projectMap.get(project) || 0) + totalTokens);

        const hour = new Date(timestamp).getHours();
        const hv = hourlyMap.get(hour) || { tokens: 0, turns: 0 };
        hv.tokens += totalTokens;
        hv.turns += 1;
        hourlyMap.set(hour, hv);
      }

      if (sessionMatched) totalSessions++;
    }

    const dailyActivity: DailyActivity[] = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.turns, cost: v.cost }))
      .filter((d) => d.tokens > 0);

    const modelActivity: ModelActivity[] = Array.from(modelMap.entries()).map(([model, v]) => ({
      model,
      harness: "pi" as const,
      tokens: v.tokens,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheTokens: v.cache,
      cost: v.cost,
    }));

    const projectActivity: ProjectActivity[] = Array.from(projectMap.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([project, tokens]) => ({ project, harness: "pi" as const, tokens }));

    const hourlyActivity: HourlyActivity[] = Array.from(hourlyMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.turns }));

    const totalTokens = dailyActivity.reduce((s, d) => s + d.tokens, 0);
    const totalCost = dailyActivity.reduce((s, d) => s + d.cost, 0);
    const totalInput = modelActivity.reduce((s, m) => s + m.inputTokens, 0);
    const totalOutput = modelActivity.reduce((s, m) => s + m.outputTokens, 0);
    const totalCache = modelActivity.reduce((s, m) => s + m.cacheTokens, 0);
    const totalTurns = dailyActivity.reduce((s, d) => s + d.turns, 0);
    const activeDays = dailyActivity.length;
    const bestDay = dailyActivity.reduce(
      (best, d) => (d.tokens > best.tokens ? d : best),
      { date: "", tokens: 0 }
    );

    if (modelFilter && totalTokens === 0) {
      return null;
    }

    return {
      harness: "pi",
      sourcePath: dir,
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

function getUsageTotal(usage?: PiMessageUsage): number {
  if (!usage) return 0;
  const totalTokens = numericToken(usage.totalTokens);
  if (totalTokens !== null && totalTokens > 0) return totalTokens;

  return tokenCount(usage.input) + tokenCount(usage.output) + tokenCount(usage.cacheRead) + tokenCount(usage.cacheWrite);
}

function getUsageCost(usage: PiMessageUsage): number {
  return tokenCount(usage.cost?.total);
}

function numericToken(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function tokenCount(value: unknown): number {
  return numericToken(value) || 0;
}

function projectNameFromFile(filePath: string): string {
  return path.basename(path.dirname(filePath)) || "(unknown)";
}

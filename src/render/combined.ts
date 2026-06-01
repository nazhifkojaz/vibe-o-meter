import type { CombinedStats } from "../types";
import { renderHeatmap } from "./heatmap";
import { renderStats } from "./stats";
import { renderByModel, renderByProject, renderByHour } from "./breakdown";

export function render(stats: CombinedStats, options: { weeks: number; by?: "model" | "project" | "hour" }): string {
  if (stats.agents.length === 0) {
    return "No AI coding agent data found.\n\nMake sure at least one of these is installed:\n  - OpenCode (~/.local/share/opencode/)\n  - Claude Code (~/.claude/)\n  - Codex (~/.codex/)\n  - Pi (~/.pi/agent/)";
  }

  const sections: string[] = [];

  if (options.by === "model") {
    sections.push(renderByModel(stats.agents));
  } else if (options.by === "project") {
    sections.push(renderByProject(stats.agents));
  } else if (options.by === "hour") {
    sections.push(renderByHour(stats.agents));
  } else {
    const harnesses = stats.agents.map((a) => a.harness).join(", ");
    const title = `Vibe Stats  [${harnesses}]`;
    sections.push(renderHeatmap(stats.combinedDaily, options.weeks, title, stats.allTimeTokens, stats.agents));
    sections.push("");
    sections.push(renderStats(stats));
  }

  return sections.join("\n");
}

export function renderJson(stats: CombinedStats): string {
  return JSON.stringify(stats, null, 2);
}

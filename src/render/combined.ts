import type { CombinedStats } from "../types";
import { harnessDisplayName } from "../types";
import { renderHeatmap } from "./heatmap";
import { renderStats } from "./stats";
import { renderByModel, renderByProject, renderByHour } from "./breakdown";
import path from "path";

export function render(stats: CombinedStats, options: { weeks: number; by?: "model" | "project" | "hour" }): string {
  if (stats.agents.length === 0) {
    return "No AI coding agent data found.\n\nChecked the default local data locations:\n  - OpenCode: $XDG_DATA_HOME/opencode/opencode.db, ~/.local/share/opencode/opencode.db, or ~/Library/Application Support/opencode/opencode.db\n  - Claude Code: ~/.claude/stats-cache.json or ~/.claude/projects/\n  - Codex: ~/.codex/state_5.sqlite or ~/.codex/sessions/\n  - Pi: ~/.pi/agent/sessions/\n\nIf your data lives elsewhere, pass an explicit path with --db, --claude, --codex, or --pi.";
  }

  const sections: string[] = [];

  if (options.by === "model") {
    sections.push(renderByModel(stats.agents));
  } else if (options.by === "project") {
    sections.push(renderByProject(stats.agents));
  } else if (options.by === "hour") {
    sections.push(renderByHour(stats.agents));
  } else {
    const harnesses = stats.agents.map((a) => harnessDisplayName(a.harness)).join(", ");
    const title = `Vibe-o-meter  [${harnesses}]`;
    sections.push(renderHeatmap(stats.combinedDaily, options.weeks, title, stats.allTimeTokens, stats.agents));
    sections.push("");
    sections.push(renderStats(stats));
  }

  return sections.join("\n");
}

export function renderJson(stats: CombinedStats): string {
  const safeStats: CombinedStats = {
    ...stats,
    agents: stats.agents.map((agent) => ({
      ...agent,
      sourcePath: redactPath(agent.sourcePath),
      projectActivity: agent.projectActivity.map((project) => ({
        ...project,
        project: redactProjectPath(project.project),
      })),
    })),
  };

  return JSON.stringify(safeStats, null, 2);
}

function redactPath(value: string): string {
  const home = process.env.HOME || "";
  if (home && (value === home || value.startsWith(home + path.sep))) {
    return "~" + value.slice(home.length);
  }

  if (path.isAbsolute(value)) {
    return path.join(path.parse(value).root, "...", path.basename(value));
  }

  return value;
}

function redactProjectPath(value: string): string {
  if (!path.isAbsolute(value)) return value;
  return path.basename(value) || redactPath(value);
}

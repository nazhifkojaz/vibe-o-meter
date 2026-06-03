import type { CombinedStats } from "../types";
import { harnessDisplayName } from "../types";
import { renderHeatmap } from "./heatmap";
import { renderStats } from "./stats";
import { renderByModel, renderByProject, renderByHour } from "./breakdown";
import path from "path";

function getTerminalWidth(): number {
  return process.stdout.columns || 120;
}

export function render(stats: CombinedStats, options: { weeks: number; by?: "model" | "project" | "hour" }): string {
  if (stats.agents.length === 0) {
    return "No AI coding agent data found.\n\nChecked common local data locations:\n  - OpenCode: $XDG_DATA_HOME/opencode/opencode.db, ~/.local/share/opencode/opencode.db, ~/Library/Application Support/opencode/opencode.db, or %APPDATA%/opencode/opencode.db\n  - Claude Code: ~/.claude, $XDG_CONFIG_HOME/claude, $XDG_DATA_HOME/claude, ~/Library/Application Support/Claude, or %APPDATA%/Claude\n  - Codex: ~/.codex, $XDG_CONFIG_HOME/codex, $XDG_DATA_HOME/codex, ~/Library/Application Support/Codex, or %APPDATA%/Codex\n  - Pi: ~/.pi/agent/sessions, $XDG_DATA_HOME/pi/agent/sessions, ~/Library/Application Support/Pi/agent/sessions, or %APPDATA%/Pi/agent/sessions\n\nRun with --verbose to see exactly which paths were checked. If your data lives elsewhere, pass an explicit path with --db, --claude, --codex, or --pi.";
  }

  const termWidth = getTerminalWidth();
  const sections: string[] = [];

  if (options.by === "model") {
    sections.push(renderByModel(stats.agents, termWidth));
  } else if (options.by === "project") {
    sections.push(renderByProject(stats.agents, termWidth));
  } else if (options.by === "hour") {
    sections.push(renderByHour(stats.agents, termWidth));
  } else {
    const maxHeatmapWeeks = Math.max(Math.floor((termWidth - 6) / 2), 4);
    const effectiveWeeks = Math.min(options.weeks, maxHeatmapWeeks);

    const harnesses = stats.agents.map((a) => harnessDisplayName(a.harness)).join(", ");
    const title = `Vibe-o-meter  [${harnesses}]`;
    sections.push(renderHeatmap(stats.combinedDaily, effectiveWeeks, title, stats.allTimeTokens, stats.agents));
    sections.push("");
    sections.push(renderStats(stats, termWidth));
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

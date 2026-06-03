import type { CombinedStats } from "../types";
import { harnessDisplayName } from "../types";
import { ANSI_RESET, ANSI_DIM, ANSI_BOLD, formatTokens, HARNESS_PALETTES, DEFAULT_PALETTE } from "./format";

function renderBar(tokens: number, maxTokens: number, width: number): string {
  const filled = maxTokens > 0 ? Math.max(Math.round((tokens / maxTokens) * width), 1) : 1;
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

function renderLegend(harness: string): string {
  const palette = HARNESS_PALETTES[harness] || DEFAULT_PALETTE;
  const parts = [`${ANSI_DIM}Less${ANSI_RESET}`];
  for (let j = 0; j < 4; j++) {
    const c = palette[Math.min(j * 2, palette.length - 1)];
    parts.push(`${c}\u25A0${ANSI_RESET}`);
  }
  parts.push(`${ANSI_DIM}More${ANSI_RESET}`);
  return parts.join(" ");
}

export function renderStats(stats: CombinedStats, termWidth: number = 120): string {
  const agents = stats.agents;
  if (agents.length === 0) return "No agent data found.";

  const maxTokens = Math.max(...agents.map((a) => a.totalTokens));
  const barWidth = Math.max(5, Math.min(10, termWidth - 80));

  const lines: string[] = [];

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const palette = HARNESS_PALETTES[a.harness] || DEFAULT_PALETTE;
    const color = palette[Math.min(4, palette.length - 1)];
    const bar = renderBar(a.totalTokens, maxTokens, barWidth);
    const name = harnessDisplayName(a.harness).padEnd(12);
    const tokens = formatTokens(a.totalTokens).padStart(8);
    const days = String(a.activeDays).padStart(3) + " active days";
    const streak = String(a.longestStreak).padStart(2) + "d streak";
    const peak = formatTokens(a.bestDay.tokens).padStart(8);
    const legend = termWidth >= 100 ? renderLegend(a.harness) : "";

    let line: string;
    if (termWidth >= 90) {
      line = `  ${color}${name}${ANSI_RESET} ${color}${bar}${ANSI_RESET} ${tokens} tokens | peak ${peak} | ${days} | ${streak}  ${legend}`;
    } else {
      line = `  ${color}${name}${ANSI_RESET} ${color}${bar}${ANSI_RESET} ${tokens} tokens | ${days} | ${streak}`;
    }
    lines.push(line);
  }

  const sep = "  " + "\u2500".repeat(Math.min(70, termWidth - 2));
  lines.push(sep);
  lines.push(
    `  ${ANSI_BOLD}TOTAL${ANSI_RESET}        ${" ".repeat(barWidth)} ${formatTokens(stats.allTimeTokens).padStart(8)} tokens | ${String(stats.allTimeActiveDays).padStart(3)} active days`
  );

  return lines.join("\n");
}

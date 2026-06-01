import type { CombinedStats } from "../types";

const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = "\x1b[2m";
const ANSI_BOLD = "\x1b[1m";
const COLORS = [
  "\x1b[38;5;41m",
  "\x1b[38;5;214m",
  "\x1b[38;5;69m",
  "\x1b[38;5;176m",
  "\x1b[38;5;220m",
];

function formatTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return "n/a";
  return "$" + n.toFixed(2);
}

function renderBar(tokens: number, maxTokens: number, width: number): string {
  const filled = maxTokens > 0 ? Math.max(Math.round((tokens / maxTokens) * width), 1) : 1;
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

const PALETTES: Record<string, string[]> = {
  opencode: ["\x1b[38;5;22m", "\x1b[38;5;28m", "\x1b[38;5;34m", "\x1b[38;5;40m", "\x1b[38;5;82m", "\x1b[38;5;118m", "\x1b[38;5;155m", "\x1b[38;5;191m"],
  claude:   ["\x1b[38;5;52m", "\x1b[38;5;94m", "\x1b[38;5;130m", "\x1b[38;5;166m", "\x1b[38;5;202m", "\x1b[38;5;208m", "\x1b[38;5;214m", "\x1b[38;5;220m"],
  codex:    ["\x1b[38;5;17m", "\x1b[38;5;19m", "\x1b[38;5;27m", "\x1b[38;5;33m", "\x1b[38;5;39m", "\x1b[38;5;69m", "\x1b[38;5;75m", "\x1b[38;5;117m"],
  pi:       ["\x1b[38;5;53m", "\x1b[38;5;96m", "\x1b[38;5;132m", "\x1b[38;5;168m", "\x1b[38;5;169m", "\x1b[38;5;176m", "\x1b[38;5;218m", "\x1b[38;5;224m"],
};
const DEFAULT_PALETTE = PALETTES.opencode;

function renderLegend(harness: string): string {
  const palette = PALETTES[harness] || DEFAULT_PALETTE;
  const parts = [`${ANSI_DIM}Less${ANSI_RESET}`];
  for (let j = 0; j < 4; j++) {
    const c = palette[Math.min(j * 2, palette.length - 1)];
    parts.push(`${c}\u25A0${ANSI_RESET}`);
  }
  parts.push(`${ANSI_DIM}More${ANSI_RESET}`);
  return parts.join(" ");
}

export function renderStats(stats: CombinedStats): string {
  const agents = stats.agents;
  if (agents.length === 0) return "No agent data found.";

  const maxTokens = Math.max(...agents.map((a) => a.totalTokens));
  const barWidth = 10;

  const lines: string[] = [];

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const color = COLORS[i % COLORS.length];
    const bar = renderBar(a.totalTokens, maxTokens, barWidth);
    const name = a.harness.padEnd(10);
    const tokens = formatTokens(a.totalTokens).padStart(8);
    const days = String(a.activeDays).padStart(3) + " active days";
    const streak = String(a.longestStreak).padStart(2) + "d streak";
    const peak = formatTokens(a.bestDay.tokens).padStart(8);
    const cost = formatCost(a.totalCost).padStart(8);
    const legend = renderLegend(a.harness);

    lines.push(
      `  ${color}${name}${ANSI_RESET} ${color}${bar}${ANSI_RESET} ${tokens} tokens | ${days} | ${streak} | peak ${peak} | ${cost}  ${legend}`
    );
  }

  const sep = "  " + "\u2500".repeat(70);
  lines.push(sep);
  lines.push(
    `  ${ANSI_BOLD}TOTAL${ANSI_RESET}     ${formatTokens(stats.allTimeTokens).padStart(8)} tokens | ${stats.allTimeActiveDays} active days | ${formatCost(stats.allTimeCost).padStart(8)} cost`
  );

  return lines.join("\n");
}

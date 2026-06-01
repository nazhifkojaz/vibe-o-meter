import type { AgentStats, ModelActivity, ProjectActivity, HourlyActivity } from "../types";

const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = "\x1b[2m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
const BAR_CHAR = "\u2588";
const BAR_EMPTY = "\u2591";

function formatTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export function renderByModel(agents: AgentStats[]): string {
  const modelMap = new Map<string, { tokens: number; harnesses: Set<string> }>();
  for (const agent of agents) {
    for (const m of agent.modelActivity) {
      const existing = modelMap.get(m.model) || { tokens: 0, harnesses: new Set() };
      existing.tokens += m.tokens;
      existing.harnesses.add(agent.harness);
      modelMap.set(m.model, existing);
    }
  }

  const sorted = Array.from(modelMap.entries()).sort((a, b) => b[1].tokens - a[1].tokens);
  const maxTokens = sorted[0]?.[1].tokens || 1;
  const totalTokens = sorted.reduce((s, [, v]) => s + v.tokens, 0);
  const barWidth = 20;

  const lines: string[] = [];
  lines.push(`  ${ANSI_BOLD}Tokens by Model${ANSI_RESET}`);
  lines.push("");

  for (const [model, data] of sorted) {
    const bar = BAR_CHAR.repeat(Math.max(Math.round((data.tokens / maxTokens) * barWidth), 1));
    const pct = ((data.tokens / totalTokens) * 100).toFixed(0);
    const name = model.padEnd(30);
    const harnesses = Array.from(data.harnesses).join(", ");
    lines.push(
      `  ${ANSI_CYAN}${name}${ANSI_RESET} ${bar} ${formatTokens(data.tokens).padStart(8)} (${pct}%) ${ANSI_DIM}[${harnesses}]${ANSI_RESET}`
    );
  }

  return lines.join("\n");
}

export function renderByProject(agents: AgentStats[]): string {
  const projectMap = new Map<string, number>();
  for (const agent of agents) {
    for (const p of agent.projectActivity) {
      const name = shortenPath(p.project);
      projectMap.set(name, (projectMap.get(name) || 0) + p.tokens);
    }
  }

  const sorted = Array.from(projectMap.entries()).sort((a, b) => b[1] - a[1]);
  const maxTokens = sorted[0]?.[1] || 1;
  const totalTokens = sorted.reduce((s, [, v]) => s + v, 0);
  const barWidth = 20;

  const lines: string[] = [];
  lines.push(`  ${ANSI_BOLD}Tokens by Project${ANSI_RESET}`);
  lines.push("");

  for (const [project, tokens] of sorted) {
    const bar = BAR_CHAR.repeat(Math.max(Math.round((tokens / maxTokens) * barWidth), 1));
    const pct = ((tokens / totalTokens) * 100).toFixed(0);
    const name = project.padEnd(35);
    lines.push(
      `  ${ANSI_CYAN}${name}${ANSI_RESET} ${bar} ${formatTokens(tokens).padStart(8)} (${pct}%)`
    );
  }

  return lines.join("\n");
}

export function renderByHour(agents: AgentStats[]): string {
  const hourlyMap = new Map<number, { tokens: number; turns: number }>();
  for (const agent of agents) {
    for (const h of agent.hourlyActivity) {
      const existing = hourlyMap.get(h.hour) || { tokens: 0, turns: 0 };
      existing.tokens += h.tokens;
      existing.turns += h.turns;
      hourlyMap.set(h.hour, existing);
    }
  }

  const maxTokens = Math.max(...Array.from(hourlyMap.values()).map((v) => v.tokens || v.turns), 1);
  const barWidth = 30;

  const lines: string[] = [];
  lines.push(`  ${ANSI_BOLD}Activity by Hour of Day${ANSI_RESET}`);
  lines.push("");

  for (let hour = 0; hour < 24; hour++) {
    const data = hourlyMap.get(hour) || { tokens: 0, turns: 0 };
    const value = data.tokens || data.turns;
    const bar = BAR_CHAR.repeat(Math.round((value / maxTokens) * barWidth));
    const label = hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`;
    const tokens = data.tokens > 0 ? formatTokens(data.tokens) : `${data.turns} turns`;
    lines.push(`  ${label.padStart(3)} ${bar} ${ANSI_DIM}${tokens}${ANSI_RESET}`);
  }

  return lines.join("\n");
}

function shortenPath(p: string): string {
  const home = process.env.HOME || "";
  if (home && p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

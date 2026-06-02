import type { DailyActivity, AgentStats, HarnessName } from "../types";

const LEVELS = ["\u2591", "\u2592", "\u2593", "\u2588"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ANSI_DIM = "\x1b[2m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_RESET = "\x1b[0m";
const EMPTY_COLOR = "\x1b[38;5;240m";
const BLOCK = "\u25A0";

const HARNESS_PALETTES: Record<string, string[]> = {
  opencode: ["\x1b[38;5;22m", "\x1b[38;5;28m", "\x1b[38;5;34m", "\x1b[38;5;40m", "\x1b[38;5;82m", "\x1b[38;5;118m", "\x1b[38;5;155m", "\x1b[38;5;191m"],
  claude:   ["\x1b[38;5;52m", "\x1b[38;5;94m", "\x1b[38;5;130m", "\x1b[38;5;166m", "\x1b[38;5;202m", "\x1b[38;5;208m", "\x1b[38;5;214m", "\x1b[38;5;220m"],
  codex:    ["\x1b[38;5;17m", "\x1b[38;5;19m", "\x1b[38;5;27m", "\x1b[38;5;33m", "\x1b[38;5;39m", "\x1b[38;5;69m", "\x1b[38;5;75m", "\x1b[38;5;117m"],
  pi:       ["\x1b[38;5;53m", "\x1b[38;5;96m", "\x1b[38;5;132m", "\x1b[38;5;168m", "\x1b[38;5;169m", "\x1b[38;5;176m", "\x1b[38;5;218m", "\x1b[38;5;224m"],
};

const HARNESS_COLORS: Record<string, string> = {
  opencode: "\x1b[38;5;41m",
  claude: "\x1b[38;5;214m",
  codex: "\x1b[38;5;69m",
  pi: "\x1b[38;5;176m",
};

const DEFAULT_PALETTE = HARNESS_PALETTES.opencode;

const LABEL_WIDTH = 4; // "Mon " = 4 display columns
const CELL_WIDTH = 2;  // block char + space

function getLevel(tokens: number, thresholds: number[]): number {
  if (tokens === 0) return -1;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (tokens >= thresholds[i]) return i;
  }
  return 0;
}

function computeThresholds(values: number[]): number[] {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [1];
  const p = (pct: number) => positive[Math.floor(positive.length * pct)];
  return [positive[0], p(0.15), p(0.35), p(0.55), p(0.75), p(0.9), positive[positive.length - 1]];
}

function dateToGrid(weeks: number): { startDate: Date; endDate: Date; grid: (DailyActivity | null)[][] } {
  const today = new Date();
  const dayOfWeek = today.getDay();

  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (weeks - 1) * 7 - dayOfWeek);

  const grid: (DailyActivity | null)[][] = [];
  for (let dow = 0; dow < 7; dow++) {
    grid[dow] = [];
    for (let w = 0; w < weeks; w++) {
      grid[dow][w] = null;
    }
  }

  const d = new Date(startDate);
  while (d <= endDate) {
    const dow = d.getDay();
    const diffMs = d.getTime() - startDate.getTime();
    const weekIdx = Math.floor(diffMs / (7 * 86400000));
    if (weekIdx >= 0 && weekIdx < weeks) {
      grid[dow][weekIdx] = {
        date: formatDate(d),
        tokens: 0,
        turns: 0,
        cost: 0,
      };
    }
    d.setDate(d.getDate() + 1);
  }

  return { startDate, endDate, grid };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderMonthHeader(grid: (DailyActivity | null)[][], weeks: number): string {
  // Build header as a flat array of display characters.
  // Total width = LABEL_WIDTH prefix + weeks * CELL_WIDTH data columns.
  const totalWidth = LABEL_WIDTH + weeks * CELL_WIDTH;
  const headerChars: string[] = new Array(totalWidth).fill(" ");

  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    let monthOfFirstDay = -1;
    for (let dow = 0; dow < 7; dow++) {
      const cell = grid[dow]?.[w];
      if (cell) {
        const d = new Date(cell.date);
        if (d.getDate() === 1) {
          monthOfFirstDay = d.getMonth();
          break;
        }
      }
    }

    if (monthOfFirstDay !== -1 && monthOfFirstDay !== lastMonth) {
      const label = MONTH_LABELS[monthOfFirstDay].slice(0, 3);
      const startCol = LABEL_WIDTH + w * CELL_WIDTH;
      for (let i = 0; i < label.length && startCol + i < totalWidth; i++) {
        headerChars[startCol + i] = label[i];
      }
      lastMonth = monthOfFirstDay;
    }
  }

  return ANSI_DIM + headerChars.join("") + ANSI_RESET;
}

function buildDominantHarness(agents: AgentStats[]): Map<string, string> {
  const best = new Map<string, { harness: string; tokens: number }>();
  for (const agent of agents) {
    for (const d of agent.dailyActivity) {
      if (d.tokens > 0) {
        const existing = best.get(d.date);
        if (!existing || d.tokens > existing.tokens) {
          best.set(d.date, { harness: agent.harness, tokens: d.tokens });
        }
      }
    }
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.harness]));
}

export function renderHeatmap(
  daily: DailyActivity[],
  weeks: number,
  title: string,
  totalTokens: number,
  agents: AgentStats[] = []
): string {
  const { startDate, endDate, grid } = dateToGrid(weeks);

  const dailyMap = new Map<string, DailyActivity>();
  for (const d of daily) {
    dailyMap.set(d.date, d);
  }

  for (let dow = 0; dow < 7; dow++) {
    for (let w = 0; w < weeks; w++) {
      if (grid[dow][w]) {
        const dateStr = grid[dow][w]!.date;
        grid[dow][w] = dailyMap.get(dateStr) || grid[dow][w];
      }
    }
  }

  const allTokenValues: number[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let w = 0; w < weeks; w++) {
      if (grid[dow][w]) {
        const dateStr = grid[dow][w]!.date;
        const d = dailyMap.get(dateStr);
        if (d && d.tokens > 0) allTokenValues.push(d.tokens);
      }
    }
  }
  const thresholds = computeThresholds(allTokenValues);
  const dominantMap = buildDominantHarness(agents);

  // Determine date range for title
  const firstDate = grid[0][0]?.date;
  const lastDate = formatDateLocal(endDate);
  let dateRange = "";
  if (firstDate) {
    const fd = parseDateParts(firstDate);
    const ld = parseDateParts(lastDate);
    const fStr = `${MONTH_LABELS[fd.month].slice(0, 3)} ${fd.day}, ${fd.year}`;
    const lStr = `${MONTH_LABELS[ld.month].slice(0, 3)} ${ld.day}, ${ld.year}`;
    dateRange = `${fStr} — ${lStr}`;
  }

  const lines: string[] = [];

  lines.push(
    `  ${ANSI_BOLD}${title}${ANSI_RESET}  ${formatTokens(totalTokens)} tokens  ${ANSI_DIM}${dateRange}${ANSI_RESET}`
  );
  lines.push("");

  // Month header with proper alignment
  lines.push(renderMonthHeader(grid, weeks));

  const todayStr = formatDateLocal(new Date());
  const todayDow = new Date().getDay();

  const firstCell = grid[0][0] || grid[1]?.[0] || grid[2]?.[0];
  let firstDow = 0;
  if (firstCell) {
    const p = parseDateParts(firstCell.date);
    firstDow = new Date(p.year, p.month, p.day).getDay();
  }
  const showDays: number[] = [];
  for (let d = 0; d < 7; d++) {
    showDays.push((firstDow + d) % 7);
  }

  const todayShowIdx = showDays.indexOf(todayDow);

  const labelDows = new Set([showDays[0], showDays[2], showDays[4]]);

  for (let i = 0; i < showDays.length; i++) {
    const dow = showDays[i];
    const label = DAY_LABELS[dow];
    let prefix = "";
    if (labelDows.has(dow)) {
      prefix = `${ANSI_DIM}${label}${ANSI_RESET} `;
    } else {
      prefix = "    ";
    }

    let bar = "";
    let currentColor = "";
    for (let w = 0; w < weeks; w++) {
      const cell = grid[dow][w];
      const isAfterEnd = w === weeks - 1 && i > todayShowIdx;
      if (!cell || cell.date > todayStr || isAfterEnd) {
        bar += "  ";
        currentColor = "";
        continue;
      }
      const tokens = cell.tokens || 0;
      const level = getLevel(tokens, thresholds);
      let color;
      if (level < 0) {
        color = EMPTY_COLOR;
      } else {
        const harness = dominantMap.get(cell.date) || "opencode";
        const palette = HARNESS_PALETTES[harness] || DEFAULT_PALETTE;
        color = palette[Math.min(level, palette.length - 1)];
      }
      if (color !== currentColor) {
        bar += color;
        currentColor = color;
      }
      bar += BLOCK + " ";
    }
    bar += ANSI_RESET;

    lines.push(prefix + bar);
  }

  return lines.join("\n");
}

function formatTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

# vibe-stats — Implementation Plan

A terminal tool to read and visualize AI coding agent usage across multiple harnesses (OpenCode, Claude Code, Codex, Pi). Think GitHub contribution heatmap, but for your AI-assisted coding activity.

## Supported Agents

| Agent | Token Data | Source | Format |
|-------|-----------|--------|--------|
| **OpenCode** | Per-session + per-message (input/output/reasoning/cache) | `~/.local/share/opencode/opencode.db` | SQLite |
| **Claude Code** | Per-model per-day aggregates + cost | `~/.claude/stats-cache.json` | JSON |
| **Codex** | Per-thread `tokens_used` counter + timestamps | `~/.codex/state_5.sqlite` | SQLite |
| **Pi** | Per-message `usage.totalTokens` in sessions | `~/.pi/agent/sessions/` | JSONL |

## Dimensions

| Dimension | What it shows | Example |
|-----------|--------------|---------|
| **Per harness** (default) | Tokens per agent tool | opencode: 4.2M, claude: 3.1M |
| **Per model** | Tokens per LLM | claude-sonnet-4-5: 5M, gpt-5: 3M |
| **Per project** | Tokens per working dir | ~/work/api: 3M, ~/play/foo: 1M |
| **Per day** (heatmap) | Daily activity grid | GitHub-style contribution chart |
| **Per hour** | Time-of-day patterns | Peak at 2pm, quiet at 3am |
| **Token type** | Input vs output vs cache | How much is cache-reused vs fresh |
| **Cost** | USD across harnesses/models | $23.51 total this month |

## Architecture

```
src/
  index.ts              — CLI entry, arg parsing, orchestration
  types.ts              — Shared interfaces
  sources/
    registry.ts         — Auto-detect installed agents, return source→parser map
    opencode.ts         — OpenCode: SQLite → DailyActivity[]
    claude.ts           — Claude Code: stats-cache.json → DailyActivity[]
    codex.ts            — Codex: state_5.sqlite → DailyActivity[]
    pi.ts               — Pi: session JSONL files → DailyActivity[]
  compute.ts            — Streaks, peaks, daily aggregation
  render/
    heatmap.ts          — ASCII heatmap (GitHub-style grid)
    stats.ts            — Per-agent stats rows + summary line
    breakdown.ts        — Dimension views (by model, by project, by hour)
    combined.ts         — Orchestrate full terminal output
```

## Unified Data Model

```typescript
interface DailyActivity {
  date: string;          // "2026-06-01"
  tokens: number;
  turns: number;
  cost: number;
}

interface ModelActivity {
  date: string;
  model: string;
  provider: string;      // "anthropic", "openai", "google", "opencode-go"
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  harness: string;       // "opencode", "claude", "codex", "pi"
}

interface ProjectActivity {
  date: string;
  project: string;       // working directory path or slug
  tokens: number;
  harness: string;
}

interface HourlyActivity {
  hour: number;          // 0-23
  tokens: number;
  turns: number;
}

interface AgentStats {
  harness: string;
  sourcePath: string;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalCost: number;
  totalTurns: number;
  totalSessions: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  bestDay: { date: string; tokens: number };
  dailyActivity: DailyActivity[];
  modelActivity: ModelActivity[];
  projectActivity: ProjectActivity[];
  hourlyActivity: HourlyActivity[];
}

interface CombinedStats {
  agents: AgentStats[];
  combinedDaily: DailyActivity[];
  allTimeTokens: number;
  allTimeCost: number;
}
```

## Data Source Parsers

### OpenCode (`sources/opencode.ts`)

**Source:** `~/.local/share/opencode/opencode.db` (SQLite)

**Session table schema:**
```
session: id, project_id, directory, title, model, cost REAL,
  tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
  tokens_cache_read INTEGER, tokens_cache_write INTEGER,
  time_created, time_updated
```

**Message table:** JSON `data` column with `{tokens: {input, output, reasoning, cache: {read, write}}, modelID, providerID}`

**Queries:**
- Daily: `SELECT DATE(time_created/1000, 'unixepoch'), SUM(tokens_input+tokens_output+tokens_reasoning), SUM(cost), COUNT(*) FROM session GROUP BY date`
- Model: Parse message data JSON for per-model token breakdown
- Project: `GROUP BY directory`

**Open read-only** (`?mode=ro`) to avoid locking the WAL journal.

### Claude Code (`sources/claude.ts`)

**Source:** `~/.claude/stats-cache.json`

**Structure:**
```json
{
  "dailyModelTokens": [{"date": "...", "tokensByModel": {"model": count}}],
  "modelUsage": {"model": {"inputTokens", "outputTokens", "cacheReadInputTokens", "costUSD"}},
  "dailyActivity": [{"date": "...", "messageCount", "sessionCount", "toolCallCount"}],
  "hourCounts": [...]
}
```

**Processing:**
1. Sum all models per day from `dailyModelTokens` → daily token totals
2. Use `modelUsage` for per-model input/output/cache breakdown
3. Use `dailyActivity` for turn/session counts
4. No per-project data available

### Codex (`sources/codex.ts`)

**Source:** `~/.codex/state_5.sqlite` (SQLite)

**Threads table schema:**
```
threads: id, tokens_used INTEGER, model, model_provider, cwd,
  created_at_ms, updated_at_ms, title
```

**Queries:**
- Daily: `SELECT DATE(updated_at_ms/1000, 'unixepoch'), SUM(tokens_used), COUNT(*) FROM threads WHERE tokens_used > 0 GROUP BY date`
- Model: `GROUP BY model`
- Project: `GROUP BY cwd`

**Limitations:** No input/output/cache breakdown, no turn count, no cost data.

### Pi (`sources/pi.ts`)

**Source:** `~/.pi/agent/sessions/<project-slug>/<timestamp>_<uuid>.jsonl`

**Session file structure:**
- Header line: `{"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}`
- Assistant messages: `{"type":"message","role":"assistant","provider":"...","model":"...","usage":{"input":N,"output":N,"cacheRead":N,"totalTokens":N,"cost":{"total":N}}}`

**Processing:**
1. Glob all `**/*.jsonl` files under `~/.pi/agent/sessions/`
2. Stream-read lines, filter for assistant messages with usage data
3. Extract: date, tokens, model, provider, cost, project (from session header cwd)
4. Aggregate per day

**Rich data:** Input/output/cache breakdown, cost, model, provider, project, hourly.

## Compute Layer (`compute.ts`)

```typescript
function computeStreaks(dailyActivity: DailyActivity[]): {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
}

function computePeaks(dailyActivity: DailyActivity[]): {
  bestDay: { date: string; tokens: number };
}

function aggregateDaily(agents: AgentStats[]): DailyActivity[]
function filterTimeRange(stats: CombinedStats, weeks: number): CombinedStats
```

**Streak logic:** Walk backwards from today. A day with `tokens > 0` is active. Break on first inactive day for current streak. Scan full history for longest.

## Render Layer

### Heatmap (`render/heatmap.ts`)

GitHub-style contribution grid:
```
     May 
     □█▓▓
 Mon ▒▓▓█
     ██□▒
 Wed ██□ 
     ▓▒□ 
 Fri ▓█□ 
     █▓░ 
     Less □░▒▓█ More
```

- Rows = days of week (Mon-Sun), columns = weeks
- Color scale: `□ ░ ▒ ▓ █` (5 levels, relative to max)
- Auto-size to terminal width
- Combined heatmap = sum of all agents per day

### Stats Table (`render/stats.ts`)

```
  opencode  ██ 4.2M tokens | 19 active days | 4d streak | peak 1.2M | $12.50
  claude    ▓▓ 3.1M tokens | 12 active days | 3d streak | peak 800K | $6.20
  codex     ▓░ 2.8M tokens |  8 active days | 2d streak | peak 600K |  n/a
  pi        ▒░ 1.5M tokens |  6 active days | 1d streak | peak 400K | $4.81
  ─────────────────────────────────────────────────────────────────────
  TOTAL       11.7M tokens | 48 active days | $23.51 | 1.4B all-time
```

### Breakdown Views (`render/breakdown.ts`)

**`--by model`:** Horizontal bar chart of tokens per model with percentage
**`--by project`:** Horizontal bar chart of tokens per project
**`--by hour`:** 24-row activity chart showing tokens by hour of day

## CLI Interface

```
Usage: vibe-stats [options]

Options:
  --weeks <n>        Number of weeks to show (default: auto-fit terminal)
  --agent <name>     Filter to single harness (opencode, claude, codex, pi)
  --by <dimension>   Breakdown view: model, project, hour
  --json             Output raw JSON
  --db <path>        Override OpenCode DB path
  --claude <path>    Override Claude stats-cache path
  --codex <path>     Override Codex DB path
  --pi <path>        Override Pi sessions dir path
  --help             Show help
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Agent not installed | Skip silently, don't error |
| Empty DB / no sessions | Show "no data" for that agent |
| Corrupt JSONL line | Skip line, continue parsing |
| Very large SQLite DB | Use streaming queries, limit columns |
| Timezone issues | All dates in local timezone |
| OpenCode directory is "/" | Label as "(global)" |
| Claude stats-cache has future dates | Filter out dates after today |
| Codex `tokens_used = 0` | Exclude from token calculations |
| Pi session files being written | Open read-only, skip locked files |
| Terminal too narrow | Truncate weeks |
| No terminal (piped) | Auto-disable colors |

## Implementation Order

1. Project scaffold (`package.json`, `tsconfig.json`)
2. Types (`src/types.ts`)
3. OpenCode parser
4. Claude Code parser
5. Codex parser
6. Pi parser
7. Registry + auto-detection
8. Compute layer
9. Heatmap renderer
10. Stats table renderer
11. Breakdown views renderer
12. Combined renderer
13. CLI entry + arg parsing
14. Test against real data on disk

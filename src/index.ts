import { collectAll } from "./sources/registry";
import { buildCombined, filterTimeRange } from "./compute";
import { render, renderJson } from "./render/combined";
import type { CliOptions } from "./types";

const VALID_BREAKDOWNS = new Set(["model", "project", "hour"]);

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--weeks":
        options.weeks = parseWeeks(readOptionValue(args, ++i, arg));
        break;
      case "--agent":
        options.agent = readOptionValue(args, ++i, arg);
        break;
      case "--model":
        options.model = readOptionValue(args, ++i, arg);
        break;
      case "--by":
        options.by = parseBreakdown(readOptionValue(args, ++i, arg));
        break;
      case "--json":
        options.json = true;
        break;
      case "--db":
        options.db = readOptionValue(args, ++i, arg);
        break;
      case "--claude":
        options.claude = readOptionValue(args, ++i, arg);
        break;
      case "--codex":
        options.codex = readOptionValue(args, ++i, arg);
        break;
      case "--pi":
        options.pi = readOptionValue(args, ++i, arg);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${option}`);
  }
  return value;
}

function parseWeeks(value: string): number {
  const weeks = Number(value);
  if (!Number.isInteger(weeks) || weeks < 1) {
    fail("--weeks must be a positive integer");
  }
  return weeks;
}

function parseBreakdown(value: string): CliOptions["by"] {
  if (!VALID_BREAKDOWNS.has(value)) {
    fail("--by must be one of: model, project, hour");
  }
  return value as CliOptions["by"];
}

function fail(message: string): never {
  console.error(message);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`
vibe-stats — AI coding agent usage visualizer

USAGE
  vibe-stats [options]

OPTIONS
  --weeks <n>        Number of weeks in heatmap (default: 53, like GitHub)
  --agent <names>    Filter to one or more harnesses, comma-separated (opencode,claude,codex,pi)
  --model <name>     Filter to a specific model (substring match, e.g. gpt-4o)
  --by <dimension>   Breakdown: model, project, hour
  --json             Output raw JSON
  --db <path>        Override OpenCode DB path
  --claude <path>    Override Claude stats-cache path
  --codex <path>     Override Codex DB path
  --pi <path>        Override Pi sessions dir path
  -h, --help         Show this help

EXAMPLES
  vibe-stats                          Combined heatmap + stats
  vibe-stats --agent opencode         OpenCode only
  vibe-stats --agent opencode,claude  OpenCode and Claude
  vibe-stats --model gpt-4o           Filter to gpt-4o model across all agents
  vibe-stats --by model               Token breakdown by model
  vibe-stats --by project             Token breakdown by project
  vibe-stats --by hour                Activity by hour of day
  vibe-stats --weeks 8 --json         8 weeks as JSON
`);
}

function main() {
  const options = parseArgs();
  const agents = collectAll(options);
  const combined = buildCombined(agents);

  const weeks = options.weeks || 53;

  const filtered = filterTimeRange(combined.agents, weeks);
  const filteredCombined = { ...combined, agents: filtered, combinedDaily: combined.combinedDaily };

  if (options.json) {
    console.log(renderJson(combined));
  } else {
    console.log(render(filteredCombined, { weeks, by: options.by }));
  }
}

main();

import { collectAll } from "./sources/registry";
import { buildCombined, filterTimeRange } from "./compute";
import { render, renderJson } from "./render/combined";
import type { CliOptions } from "./types";

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--weeks":
        options.weeks = parseInt(args[++i], 10);
        break;
      case "--agent":
        options.agent = args[++i] as CliOptions["agent"];
        break;
      case "--by":
        options.by = args[++i] as CliOptions["by"];
        break;
      case "--json":
        options.json = true;
        break;
      case "--db":
        options.db = args[++i];
        break;
      case "--claude":
        options.claude = args[++i];
        break;
      case "--codex":
        options.codex = args[++i];
        break;
      case "--pi":
        options.pi = args[++i];
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

function printHelp() {
  console.log(`
vibe-stats — AI coding agent usage visualizer

USAGE
  vibe-stats [options]

OPTIONS
  --weeks <n>        Number of weeks in heatmap (default: 53, like GitHub)
  --agent <name>     Filter to single harness (opencode, claude, codex, pi)
  --by <dimension>   Breakdown: model, project, hour
  --json             Output raw JSON
  --db <path>        Override OpenCode DB path
  --claude <path>    Override Claude stats-cache path
  --codex <path>     Override Codex DB path
  --pi <path>        Override Pi sessions dir path
  -h, --help         Show this help

EXAMPLES
  vibe-stats                    Combined heatmap + stats
  vibe-stats --agent opencode   OpenCode only
  vibe-stats --by model         Token breakdown by model
  vibe-stats --by project       Token breakdown by project
  vibe-stats --by hour          Activity by hour of day
  vibe-stats --weeks 8 --json   8 weeks as JSON
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

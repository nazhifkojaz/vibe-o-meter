# vibe-stats

Terminal tool to visualize AI coding agent usage across OpenCode, Claude Code, Codex, and Pi.

## Usage

Run without installing:

```sh
npx vibe-stats
bunx vibe-stats
```

Common options:

```sh
vibe-stats --agent opencode
vibe-stats --agent opencode,claude
vibe-stats --model gpt-4o
vibe-stats --by model
vibe-stats --by project
vibe-stats --by hour
vibe-stats --weeks 8 --json
```

## Data Sources

By default, `vibe-stats` reads local usage data from:

- OpenCode: `~/.local/share/opencode/opencode.db`
- Claude Code: `~/.claude/stats-cache.json`
- Codex: `~/.codex/state_5.sqlite` and `~/.codex/sessions`
- Pi: `~/.pi/agent/sessions`

Override paths when needed:

```sh
vibe-stats --db /path/to/opencode.db
vibe-stats --claude /path/to/stats-cache.json
vibe-stats --codex /path/to/state_5.sqlite
vibe-stats --pi /path/to/sessions
```

## Privacy

This tool reads local files only and does not send usage data over the network.

Human-readable output may include shortened project paths for project breakdowns. JSON output redacts source path parent directories and reduces absolute project paths to their basename to lower accidental local path disclosure risk.

When `--model` is used, token totals are filtered to matching models. If a source does not expose model-specific session, turn, or hourly metadata, those fields are reported as unavailable (`0` or empty arrays) instead of guessed.

## License

MIT

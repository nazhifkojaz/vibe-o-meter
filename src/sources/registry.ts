import fs from "fs";
import type { AgentStats, HarnessName, CliOptions } from "../types";
import * as opencode from "./opencode";
import * as claude from "./claude";
import * as codex from "./codex";
import * as pi from "./pi";

const HOME = process.env.HOME || "";

interface SourceConfig {
  name: HarnessName;
  defaultPath: string;
  pathKey: keyof Pick<CliOptions, "db" | "claude" | "codex" | "pi">;
  parse: (customPath?: string) => AgentStats | null;
}

const SOURCES: SourceConfig[] = [
  {
    name: "opencode",
    defaultPath: `${HOME}/.local/share/opencode/opencode.db`,
    pathKey: "db",
    parse: opencode.parse,
  },
  {
    name: "claude",
    defaultPath: `${HOME}/.claude/stats-cache.json`,
    pathKey: "claude",
    parse: claude.parse,
  },
  {
    name: "codex",
    defaultPath: `${HOME}/.codex/state_5.sqlite`,
    pathKey: "codex",
    parse: (customPath?: string) => codex.parse(customPath, `${HOME}/.codex/sessions`),
  },
  {
    name: "pi",
    defaultPath: `${HOME}/.pi/agent/sessions`,
    pathKey: "pi",
    parse: pi.parse,
  },
];

export function collectAll(options: CliOptions = {}): AgentStats[] {
  const filter = options.agent;
  const agents: AgentStats[] = [];

  for (const source of SOURCES) {
    if (filter && source.name !== filter) continue;

    const customPath = options[source.pathKey];
    const resolvedPath = customPath || source.defaultPath;

    if (!customPath && !exists(resolvedPath)) continue;

    const stats = source.parse(customPath || undefined);
    if (stats) agents.push(stats);
  }

  return agents;
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

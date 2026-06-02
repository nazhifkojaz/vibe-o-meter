import fs from "fs";
import path from "path";
import type { AgentStats, HarnessName, CliOptions } from "../types";
import * as opencode from "./opencode";
import * as claude from "./claude";
import * as codex from "./codex";
import * as pi from "./pi";

const HOME = process.env.HOME || "";
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share");
const APPDATA = process.env.APPDATA || "";

interface SourceConfig {
  name: HarnessName;
  defaultPaths: string[];
  pathKey: keyof Pick<CliOptions, "db" | "claude" | "codex" | "pi">;
  parse: (customPath?: string, modelFilter?: string) => AgentStats | null;
}

const SOURCES: SourceConfig[] = [
  {
    name: "opencode",
    defaultPaths: compact([
      path.join(XDG_DATA_HOME, "opencode", "opencode.db"),
      path.join(HOME, ".local", "share", "opencode", "opencode.db"),
      path.join(HOME, "Library", "Application Support", "opencode", "opencode.db"),
      path.join(HOME, "Library", "Application Support", "dev.opencode", "opencode.db"),
      APPDATA ? path.join(APPDATA, "opencode", "opencode.db") : "",
    ]),
    pathKey: "db",
    parse: opencode.parse,
  },
  {
    name: "claude",
    defaultPaths: [path.join(HOME, ".claude")],
    pathKey: "claude",
    parse: claude.parse,
  },
  {
    name: "codex",
    defaultPaths: [path.join(HOME, ".codex")],
    pathKey: "codex",
    parse: (customPath?: string, modelFilter?: string) => codex.parse(customPath, undefined, modelFilter),
  },
  {
    name: "pi",
    defaultPaths: [path.join(HOME, ".pi", "agent", "sessions")],
    pathKey: "pi",
    parse: pi.parse,
  },
];

export function collectAll(options: CliOptions = {}): AgentStats[] {
  const filterSet = options.agent
    ? new Set(options.agent.split(",").map(s => s.trim().toLowerCase()))
    : null;
  const agents: AgentStats[] = [];

  for (const source of SOURCES) {
    if (filterSet && !filterSet.has(source.name)) continue;

    const customPath = options[source.pathKey];
    const resolvedPath = customPath || firstExisting(source.defaultPaths);

    if (!resolvedPath) continue;

    const stats = source.parse(resolvedPath, options.model);
    if (stats) agents.push(stats);
  }

  return agents;
}

function firstExisting(paths: string[]): string | null {
  return paths.find(exists) || null;
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function compact(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

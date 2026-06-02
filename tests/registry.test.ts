import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStats } from "../src/types";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME;
const ORIGINAL_APPDATA = process.env.APPDATA;
const tempDirs: string[] = [];

let opencodeParse: ReturnType<typeof vi.fn>;
let claudeParse: ReturnType<typeof vi.fn>;
let codexParse: ReturnType<typeof vi.fn>;
let piParse: ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.doUnmock("../src/sources/opencode");
  vi.doUnmock("../src/sources/claude");
  vi.doUnmock("../src/sources/codex");
  vi.doUnmock("../src/sources/pi");
  vi.resetModules();
  process.env.HOME = ORIGINAL_HOME;
  restoreEnv("XDG_DATA_HOME", ORIGINAL_XDG_DATA_HOME);
  restoreEnv("APPDATA", ORIGINAL_APPDATA);

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-home-"));
  tempDirs.push(home);
  return home;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function touch(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");
}

function makeStats(harness: string, sourcePath = `/mock/${harness}`): AgentStats {
  return {
    harness,
    sourcePath,
    totalTokens: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheTokens: 0,
    totalCost: 0,
    totalTurns: 1,
    totalSessions: 1,
    activeDays: 1,
    currentStreak: 0,
    longestStreak: 0,
    bestDay: { date: "2026-06-01", tokens: 1 },
    dailyActivity: [{ date: "2026-06-01", tokens: 1, turns: 1, cost: 0 }],
    modelActivity: [],
    projectActivity: [],
    hourlyActivity: [],
  };
}

async function importRegistry(home: string, env: { xdgDataHome?: string; appData?: string } = {}) {
  vi.resetModules();
  process.env.HOME = home;
  if (env.xdgDataHome) {
    process.env.XDG_DATA_HOME = env.xdgDataHome;
  } else {
    delete process.env.XDG_DATA_HOME;
  }
  if (env.appData) {
    process.env.APPDATA = env.appData;
  } else {
    delete process.env.APPDATA;
  }

  opencodeParse = vi.fn(() => makeStats("opencode"));
  claudeParse = vi.fn(() => makeStats("claude"));
  codexParse = vi.fn(() => makeStats("codex"));
  piParse = vi.fn(() => makeStats("pi"));

  vi.doMock("../src/sources/opencode", () => ({ parse: opencodeParse }));
  vi.doMock("../src/sources/claude", () => ({ parse: claudeParse }));
  vi.doMock("../src/sources/codex", () => ({ parse: codexParse }));
  vi.doMock("../src/sources/pi", () => ({ parse: piParse }));

  return import("../src/sources/registry");
}

describe("collectAll", () => {
  it("detects readable default source locations under HOME", async () => {
    const home = makeHome();
    touch(path.join(home, ".local/share/opencode/opencode.db"));
    mkdirSync(path.join(home, ".claude/projects"), { recursive: true });
    touch(path.join(home, ".codex/state_5.sqlite"));
    mkdirSync(path.join(home, ".codex/sessions"), { recursive: true });
    mkdirSync(path.join(home, ".pi/agent/sessions"), { recursive: true });

    const { collectAll } = await importRegistry(home);
    const agents = collectAll({ model: "sonnet" });

    expect(agents.map((agent) => agent.harness)).toEqual(["opencode", "claude", "codex", "pi"]);
    expect(opencodeParse).toHaveBeenCalledWith(path.join(home, ".local/share/opencode/opencode.db"), "sonnet");
    expect(claudeParse).toHaveBeenCalledWith(path.join(home, ".claude"), "sonnet");
    expect(codexParse).toHaveBeenCalledWith(path.join(home, ".codex"), undefined, "sonnet");
    expect(piParse).toHaveBeenCalledWith(path.join(home, ".pi/agent/sessions"), "sonnet");
  });

  it("detects OpenCode under XDG_DATA_HOME", async () => {
    const home = makeHome();
    const xdgDataHome = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-xdg-"));
    tempDirs.push(xdgDataHome);
    const dbPath = path.join(xdgDataHome, "opencode", "opencode.db");
    touch(dbPath);

    const { collectAll } = await importRegistry(home, { xdgDataHome });
    const agents = collectAll({ agent: "opencode" });

    expect(agents.map((agent) => agent.harness)).toEqual(["opencode"]);
    expect(opencodeParse).toHaveBeenCalledWith(dbPath, undefined);
  });

  it("detects OpenCode in a macOS Application Support location", async () => {
    const home = makeHome();
    const dbPath = path.join(home, "Library", "Application Support", "opencode", "opencode.db");
    touch(dbPath);

    const { collectAll } = await importRegistry(home);
    const agents = collectAll({ agent: "opencode" });

    expect(agents.map((agent) => agent.harness)).toEqual(["opencode"]);
    expect(opencodeParse).toHaveBeenCalledWith(dbPath, undefined);
  });

  it("detects Codex when only the sessions directory exists", async () => {
    const home = makeHome();
    mkdirSync(path.join(home, ".codex", "sessions"), { recursive: true });

    const { collectAll } = await importRegistry(home);
    const agents = collectAll({ agent: "codex" });

    expect(agents.map((agent) => agent.harness)).toEqual(["codex"]);
    expect(codexParse).toHaveBeenCalledWith(path.join(home, ".codex"), undefined, undefined);
  });

  it("skips parsers when default locations are missing", async () => {
    const { collectAll } = await importRegistry(makeHome());

    expect(collectAll()).toEqual([]);
    expect(opencodeParse).not.toHaveBeenCalled();
    expect(claudeParse).not.toHaveBeenCalled();
    expect(codexParse).not.toHaveBeenCalled();
    expect(piParse).not.toHaveBeenCalled();
  });

  it("honors explicit paths even when those paths do not exist", async () => {
    const { collectAll } = await importRegistry(makeHome());

    const agents = collectAll({
      agent: "claude,pi",
      claude: "/custom/claude/projects",
      pi: "/custom/pi/sessions",
      model: "opus",
    });

    expect(agents.map((agent) => agent.harness)).toEqual(["claude", "pi"]);
    expect(claudeParse).toHaveBeenCalledWith("/custom/claude/projects", "opus");
    expect(piParse).toHaveBeenCalledWith("/custom/pi/sessions", "opus");
    expect(opencodeParse).not.toHaveBeenCalled();
    expect(codexParse).not.toHaveBeenCalled();
  });

  it("trims and lowercases agent filters before detection", async () => {
    const home = makeHome();
    mkdirSync(path.join(home, ".claude/projects"), { recursive: true });
    mkdirSync(path.join(home, ".pi/agent/sessions"), { recursive: true });

    const { collectAll } = await importRegistry(home);
    const agents = collectAll({ agent: " Claude , PI " });

    expect(agents.map((agent) => agent.harness)).toEqual(["claude", "pi"]);
    expect(claudeParse).toHaveBeenCalledOnce();
    expect(piParse).toHaveBeenCalledOnce();
    expect(opencodeParse).not.toHaveBeenCalled();
    expect(codexParse).not.toHaveBeenCalled();
  });

  it("drops sources whose parser returns null", async () => {
    const home = makeHome();
    mkdirSync(path.join(home, ".claude/projects"), { recursive: true });
    const { collectAll } = await importRegistry(home);
    claudeParse.mockReturnValueOnce(null);

    expect(collectAll()).toEqual([]);
    expect(claudeParse).toHaveBeenCalledOnce();
  });
});

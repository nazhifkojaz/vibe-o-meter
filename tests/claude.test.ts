import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../src/sources/claude";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeClaudeFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "stats-cache.json");

  writeFileSync(filePath, JSON.stringify({
    version: 1,
    lastComputedDate: "2026-06-02",
    dailyActivity: [
      { date: "2026-05-31", messageCount: 2, sessionCount: 1, toolCallCount: 0 },
      { date: "2026-06-01", messageCount: 3, sessionCount: 1, toolCallCount: 0 },
    ],
    dailyModelTokens: [
      { date: "2026-05-31", tokensByModel: { "claude-sonnet": 100, "claude-opus": 300 } },
      { date: "2026-06-01", tokensByModel: { "claude-sonnet": 250, "claude-opus": 350 } },
    ],
    modelUsage: {
      "claude-sonnet": {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 20,
        costUSD: 1.23,
      },
      "claude-opus": {
        inputTokens: 400,
        outputTokens: 200,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 0,
        costUSD: 2,
      },
    },
    totalSessions: 2,
    totalMessages: 5,
    hourCounts: { "9": 1, "10": 3 },
    firstSessionDate: "2026-05-31",
  }));

  return filePath;
}

function writeClaudeProjectsFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-projects-"));
  tempDirs.push(root);

  const projectDir = path.join(root, "projects", "-home-alice-secret-app");
  mkdirSync(projectDir, { recursive: true });
  const filePath = path.join(projectDir, "session.jsonl");

  writeFileSync(filePath, [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T09:15:00",
      cwd: "/home/alice/secret-app",
      sessionId: "session-1",
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
        },
      },
    }),
    "not json",
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T09:45:00",
      cwd: "/home/alice/secret-app",
      sessionId: "session-1",
      message: {
        role: "assistant",
        model: "claude-opus-4",
        usage: {
          input_tokens: 200,
          output_tokens: 100,
        },
      },
    }),
  ].join("\n"));

  return root;
}

describe("claude.parse", () => {
  it("parses Claude stats-cache totals and daily activity", () => {
    const stats = parse(writeClaudeFixture());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "claude",
      totalTokens: 1000,
      totalInputTokens: 500,
      totalOutputTokens: 400,
      totalCacheTokens: 100,
      totalTurns: 5,
      totalSessions: 2,
      activeDays: 2,
      bestDay: { date: "2026-06-01", tokens: 600, turns: 3, cost: 0 },
      dailyActivity: [
        { date: "2026-05-31", tokens: 400, turns: 2, cost: 0 },
        { date: "2026-06-01", tokens: 600, turns: 3, cost: 0 },
      ],
    });
    expect(stats!.totalCost).toBeCloseTo(3.23);
    expect(stats!.modelActivity).toEqual(expect.arrayContaining([
      {
        model: "claude-sonnet",
        harness: "claude",
        tokens: 350,
        inputTokens: 100,
        outputTokens: 200,
        cacheTokens: 50,
        cost: 1.23,
      },
      {
        model: "claude-opus",
        harness: "claude",
        tokens: 650,
        inputTokens: 400,
        outputTokens: 200,
        cacheTokens: 50,
        cost: 2,
      },
    ]));
  });

  it("filters model-specific totals without guessing unavailable session metadata", () => {
    const stats = parse(writeClaudeFixture(), "sonnet");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 350,
      totalInputTokens: 100,
      totalOutputTokens: 200,
      totalCacheTokens: 50,
      totalTurns: 0,
      totalSessions: 0,
      hourlyActivity: [],
      dailyActivity: [
        { date: "2026-05-31", tokens: 100, turns: 0, cost: 0 },
        { date: "2026-06-01", tokens: 250, turns: 0, cost: 0 },
      ],
    });
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("claude-sonnet");
  });

  it("returns null when a model filter has no matching usage", () => {
    expect(parse(writeClaudeFixture(), "missing-model")).toBeNull();
  });

  it("falls back to Claude Code project JSONL logs when stats-cache is absent", () => {
    const root = writeClaudeProjectsFixture();
    const stats = parse(root);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "claude",
      sourcePath: path.join(root, "projects"),
      totalTokens: 480,
      totalInputTokens: 300,
      totalOutputTokens: 150,
      totalCacheTokens: 30,
      totalCost: 0,
      totalTurns: 2,
      totalSessions: 1,
      activeDays: 1,
      bestDay: { date: "2026-06-01", tokens: 480, turns: 2, cost: 0 },
      dailyActivity: [
        { date: "2026-06-01", tokens: 480, turns: 2, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/secret-app", harness: "claude", tokens: 480 },
      ],
      hourlyActivity: [
        { hour: 9, tokens: 480, turns: 2 },
      ],
    });
    expect(stats!.modelActivity).toEqual([
      {
        model: "claude-opus-4",
        harness: "claude",
        tokens: 300,
        inputTokens: 200,
        outputTokens: 100,
        cacheTokens: 0,
        cost: 0,
      },
      {
        model: "claude-sonnet-4",
        harness: "claude",
        tokens: 180,
        inputTokens: 100,
        outputTokens: 50,
        cacheTokens: 30,
        cost: 0,
      },
    ]);
  });

  it("filters Claude project JSONL logs by model", () => {
    const stats = parse(writeClaudeProjectsFixture(), "sonnet");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 180,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 30,
      totalTurns: 1,
      totalSessions: 1,
      dailyActivity: [
        { date: "2026-06-01", tokens: 180, turns: 1, cost: 0 },
      ],
    });
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("claude-sonnet-4");
  });

  it("accepts the Claude projects directory directly", () => {
    const root = writeClaudeProjectsFixture();
    const projectsDir = path.join(root, "projects");
    const stats = parse(projectsDir);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      sourcePath: projectsDir,
      totalTokens: 480,
      totalTurns: 2,
      totalSessions: 1,
    });
  });
});

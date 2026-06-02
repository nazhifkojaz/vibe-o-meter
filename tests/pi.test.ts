import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../src/sources/pi";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writePiFixture(): string {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-pi-"));
  tempDirs.push(sessionsDir);
  const projectDir = path.join(sessionsDir, "secret-app");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "session.jsonl"), [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "session-1",
      timestamp: "2026-06-01T08:00:00",
      cwd: "/home/alice/secret-app",
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-06-01T08:15:00",
      message: {
        role: "assistant",
        model: "pi-model",
        provider: "pi",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 20,
          cacheWrite: 10,
          totalTokens: 180,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.12 },
        },
      },
    }),
    "not json",
    JSON.stringify({
      type: "message",
      timestamp: "2026-06-01T09:00:00",
      message: {
        role: "assistant",
        model: "other-model",
        provider: "pi",
        usage: {
          input: 20,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 30,
        },
      },
    }),
  ].join("\n"));

  return sessionsDir;
}

function writePiModelChangeFixture(): string {
  const sessionsDir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-pi-model-change-"));
  tempDirs.push(sessionsDir);
  const projectDir = path.join(sessionsDir, "secret-app", "nested");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "session.jsonl"), [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "session-1",
      timestamp: "2026-06-01T08:00:00",
      cwd: "/home/alice/secret-app",
    }),
    JSON.stringify({
      type: "model_change",
      modelId: "pi-model-from-change",
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-06-01T08:15:00",
      message: {
        role: "assistant",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 20,
          cacheWrite: 10,
        },
      },
    }),
  ].join("\n"));

  return sessionsDir;
}

describe("pi.parse", () => {
  it("parses Pi session JSONL files from a sessions directory", () => {
    const sessionsDir = writePiFixture();
    const stats = parse(sessionsDir);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "pi",
      sourcePath: sessionsDir,
      totalTokens: 210,
      totalInputTokens: 120,
      totalOutputTokens: 60,
      totalCacheTokens: 30,
      totalCost: 0.12,
      totalTurns: 2,
      totalSessions: 1,
      activeDays: 1,
      bestDay: { date: "2026-06-01", tokens: 210, turns: 2, cost: 0.12 },
      dailyActivity: [
        { date: "2026-06-01", tokens: 210, turns: 2, cost: 0.12 },
      ],
      projectActivity: [
        { project: "/home/alice/secret-app", harness: "pi", tokens: 210 },
      ],
      hourlyActivity: [
        { hour: 8, tokens: 180, turns: 1 },
        { hour: 9, tokens: 30, turns: 1 },
      ],
    });
    expect(stats!.modelActivity).toEqual(expect.arrayContaining([
      { model: "pi-model", harness: "pi", tokens: 180, inputTokens: 100, outputTokens: 50, cacheTokens: 30, cost: 0.12 },
      { model: "other-model", harness: "pi", tokens: 30, inputTokens: 20, outputTokens: 10, cacheTokens: 0, cost: 0 },
    ]));
  });

  it("filters Pi sessions by model", () => {
    const stats = parse(writePiFixture(), "pi-model");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 180,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 30,
      totalTurns: 1,
      totalSessions: 1,
    });
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("pi-model");
    expect(parse(writePiFixture(), "missing-model")).toBeNull();
  });

  it("uses model_change and computes totals when totalTokens is absent", () => {
    const stats = parse(writePiModelChangeFixture());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 180,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 30,
      totalTurns: 1,
      totalSessions: 1,
      modelActivity: [
        { model: "pi-model-from-change", harness: "pi", tokens: 180, inputTokens: 100, outputTokens: 50, cacheTokens: 30, cost: 0 },
      ],
    });
  });
});

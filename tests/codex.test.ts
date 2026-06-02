import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../src/sources/codex";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeCodexSessionsFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-codex-"));
  tempDirs.push(root);

  const sessionDir = path.join(root, "sessions", "2026", "06", "01");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, "rollout-thread-1.jsonl"), [
    JSON.stringify({
      timestamp: "2026-06-01T10:00:00",
      type: "session_meta",
      payload: {
        cwd: "/home/alice/secret-app",
        model: "gpt-5",
      },
    }),
    "not json",
    JSON.stringify({
      timestamp: "2026-06-01T10:05:00",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 50,
            reasoning_output_tokens: 30,
          },
        },
      },
    }),
  ].join("\n"));

  return root;
}

describe("codex.parse", () => {
  it("falls back to Codex session JSONL logs when the SQLite state DB is absent", async () => {
    const root = writeCodexSessionsFixture();
    const stats = await parse(root);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "codex",
      sourcePath: root,
      totalTokens: 200,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 20,
      totalCost: 0,
      totalTurns: 1,
      totalSessions: 1,
      activeDays: 1,
      bestDay: { date: "2026-06-01", tokens: 200, turns: 1, cost: 0 },
      dailyActivity: [
        { date: "2026-06-01", tokens: 200, turns: 1, cost: 0 },
      ],
      modelActivity: [
        { model: "gpt-5", harness: "codex", tokens: 200, inputTokens: 100, outputTokens: 50, cacheTokens: 20, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/secret-app", harness: "codex", tokens: 200 },
      ],
      hourlyActivity: [
        { hour: 10, tokens: 200, turns: 1 },
      ],
    });
  });

  it("accepts the Codex sessions directory directly", async () => {
    const root = writeCodexSessionsFixture();
    const sessionsDir = path.join(root, "sessions");
    const stats = await parse(sessionsDir);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      sourcePath: sessionsDir,
      totalTokens: 200,
      totalTurns: 1,
      totalSessions: 1,
    });
  });

  it("filters Codex session JSONL logs by model", async () => {
    const stats = await parse(writeCodexSessionsFixture(), undefined, "gpt-5");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 200,
      modelActivity: [
        { model: "gpt-5", harness: "codex", tokens: 200, inputTokens: 100, outputTokens: 50, cacheTokens: 20, cost: 0 },
      ],
    });
    expect(await parse(writeCodexSessionsFixture(), undefined, "claude")).toBeNull();
  });
});

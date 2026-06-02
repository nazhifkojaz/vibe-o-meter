import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../src/sources/opencode";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

async function createTestDb(setup: (db: any) => void): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-opencode-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "opencode.db");

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  setup(db);
  const data = db.export();
  db.close();

  mkdirSync(path.dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, Buffer.from(data));
  return dbPath;
}

async function writeMessageOnlyOpenCodeDb(): Promise<string> {
  return createTestDb((db) => {
    db.run(`
      CREATE TABLE message (
        time_created INTEGER NOT NULL,
        session_id TEXT,
        data TEXT NOT NULL
      );
    `);

    db.run(
      "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
      [
        new Date(2026, 5, 1, 10, 15).getTime(),
        "session-1",
        JSON.stringify({
          role: "assistant",
          modelID: "gpt-5",
          cost: 0.12,
          tokens: {
            input: 100,
            output: 50,
            reasoning: 25,
            cache: { read: 20, write: 5 },
          },
        }),
      ]
    );
    db.run(
      "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
      [
        new Date(2026, 5, 1, 11, 30).getTime(),
        "session-1",
        JSON.stringify({
          role: "assistant",
          modelID: "claude-sonnet",
          cost: 0.05,
          tokens: {
            input: 40,
            output: 10,
            cache: { read: 0, write: 0 },
          },
        }),
      ]
    );
    db.run(
      "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
      [
        new Date(2026, 5, 1, 12, 0).getTime(),
        "session-1",
        JSON.stringify({ role: "user", tokens: { input: 999 } }),
      ]
    );
  });
}

describe("opencode.parse", () => {
  it("falls back to assistant message token rows when session aggregates are unavailable", async () => {
    const stats = await parse(await writeMessageOnlyOpenCodeDb());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "opencode",
      totalTokens: 250,
      totalInputTokens: 140,
      totalOutputTokens: 60,
      totalCacheTokens: 25,
      totalTurns: 2,
      totalSessions: 1,
      activeDays: 1,
      bestDay: { date: "2026-06-01", tokens: 250, turns: 2, cost: 0.16999999999999998 },
      dailyActivity: [
        { date: "2026-06-01", tokens: 250, turns: 2, cost: 0.16999999999999998 },
      ],
      hourlyActivity: [
        { hour: 10, tokens: 200, turns: 1 },
        { hour: 11, tokens: 50, turns: 1 },
      ],
    });
    expect(stats!.totalCost).toBeCloseTo(0.17);
    expect(stats!.modelActivity).toEqual(expect.arrayContaining([
      {
        model: "gpt-5",
        harness: "opencode",
        tokens: 200,
        inputTokens: 100,
        outputTokens: 50,
        cacheTokens: 25,
        cost: 0.12,
      },
      {
        model: "claude-sonnet",
        harness: "opencode",
        tokens: 50,
        inputTokens: 40,
        outputTokens: 10,
        cacheTokens: 0,
        cost: 0.05,
      },
    ]));
  });

  it("filters OpenCode message fallback rows by model", async () => {
    const stats = await parse(await writeMessageOnlyOpenCodeDb(), "gpt");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 200,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 25,
      totalTurns: 1,
      totalSessions: 1,
      dailyActivity: [
        { date: "2026-06-01", tokens: 200, turns: 1, cost: 0.12 },
      ],
    });
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("gpt-5");
  });
});

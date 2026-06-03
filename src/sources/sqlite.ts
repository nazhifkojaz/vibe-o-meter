import fs from "fs";

// Inline interfaces for the exported API types.
// See sql.js.d.ts for the matching module declaration needed by import("sql.js").
interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  close(): void;
}

interface SqlJsStatement {
  bind(params: any[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, any>;
  free(): void;
}

interface SqlJsStatic {
  Database: new (data: ArrayLike<number | bigint>) => SqlJsDatabase;
}

type SqlValue = number | string | null;

let SQL: SqlJsStatic | null = null;
let SQL_PROMISE: Promise<SqlJsStatic> | null = null;

async function getSQL(): Promise<SqlJsStatic> {
  if (SQL) return SQL;

  if (!SQL_PROMISE) {
    SQL_PROMISE = (async () => {
      const initSqlJs = (await import("sql.js")).default as (options?: any) => Promise<SqlJsStatic>;
      SQL = await initSqlJs();
      return SQL;
    })();
  }

  try {
    return await SQL_PROMISE;
  } catch (error) {
    SQL_PROMISE = null;
    throw error;
  }
}

export async function openDatabase(filePath: string): Promise<{ db: SqlJsDatabase; close: () => void }> {
  const SQL = await getSQL();
  const buffer = fs.readFileSync(filePath);
  const db = new SQL.Database(buffer);
  return {
    db,
    close: () => db.close(),
  };
}

export function queryAll(db: SqlJsDatabase, sql: string, params: SqlValue[] = []): any[] {
  const stmt = db.prepare(sql);
  try {
    if (params.length > 0) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

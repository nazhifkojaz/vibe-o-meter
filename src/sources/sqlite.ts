export let Database: any;

if (typeof Bun !== "undefined") {
  const bun = await import("bun:sqlite");
  Database = bun.Database;
} else {
  const mod = await import("better-sqlite3");
  Database = mod.default;
}

export function queryAll(db: any, sql: string, params: unknown[] = []): any[] {
  const statement = typeof db.prepare === "function" ? db.prepare(sql) : db.query(sql);
  return params.length > 0 ? statement.all(...params) : statement.all();
}

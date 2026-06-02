declare module "sql.js" {
  interface SqlJsStatic {
    Database: new (data: ArrayLike<number | bigint>) => SqlJsDatabase;
  }
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
  export default function initSqlJs(options?: any): Promise<SqlJsStatic>;
}

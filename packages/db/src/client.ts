import DatabaseConstructor from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

export { schema };

export type Database = BetterSQLite3Database<typeof schema>;

export interface CreateDbOptions {
  /** DB ファイルパス。既定: /data/asset-scraping.db (Docker) / ./.data/dev.db (ホスト) */
  path?: string;
  /** read-only 接続 (web/mcp 用)。既定 false */
  readOnly?: boolean;
}

export function resolveDbPath(): string {
  return process.env.DB_PATH ?? "./.data/asset-scraping.db";
}

/**
 * SQLite (WAL) + drizzle クライアントを生成する。
 * crawler は rw、web/mcp は readOnly: true で開く。
 */
export function createDb(options: CreateDbOptions = {}): Database {
  const path = options.path ?? resolveDbPath();

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const fileUrlMatch = /^file:(.*)$/.exec(path);
  const sqlite = new DatabaseConstructor(fileUrlMatch ? path : path, {
    // read-only は file: URL の ?mode=ro でも指定可能だが、
    // ここではフラグで明示する（URL クエリと重複しても問題ない）
    readonly: options.readOnly ?? false,
    fileMustExist: options.readOnly ?? false,
  });

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return drizzle(sqlite, { schema });
}

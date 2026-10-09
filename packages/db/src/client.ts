import DatabaseConstructor from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
// Node.js ESM で .ts ソースを直接実行する（tsx / Next.js は拡張子付き import を別解決する）ため、
// 実行時は .ts 解決が必要。tsc --noEmit との両立のため allowImportingTsExtensions を使う。
import * as schema from "./schema.ts";

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

  // better-sqlite3 は既定で URI filename を解釈しないため、file: URL は素のパスに正規化する。
  // （file: URL をそのまま渡すと「file:/data/...」という名前の空 DB が開かれてしまう）
  const filePath = path.startsWith("file:")
    ? decodeURIComponent(new URL(path).pathname)
    : path;
  const sqlite = new DatabaseConstructor(filePath, {
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

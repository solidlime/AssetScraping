import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import type { Database } from "./client.ts";
import * as schema from "./schema.ts";

/**
 * テスト用 DB を作成し、マイグレーションを適用して返す。
 * better-sqlite3 版（本家は libsql）。beforeAll で1回だけ呼び出し、
 * テスト間は resetTestDb でデータをクリアする。
 */
export function createTestDb(url = ":memory:"): Database {
  const sqlite = new BetterSqlite3(url);
  const db = drizzle(sqlite, { schema });

  // マイグレーション適用
  migrate(db, {
    migrationsFolder: join(import.meta.dirname, "../drizzle"),
  });

  return db;
}

/**
 * 全テーブルのデータをクリアする。
 * beforeEach で呼び出してテスト間の分離を保証する。
 */
export function resetTestDb(db: Database): void {
  // FK の依存順に削除
  db.delete(schema.holdingValues).run();
  db.delete(schema.holdings).run();
  db.delete(schema.accountStatuses).run();
  db.delete(schema.transactions).run();
  db.delete(schema.cashFlowMonthly).run();
  db.delete(schema.cashFlowPeriods).run();
  db.delete(schema.assetHistoryCategories).run();
  db.delete(schema.assetHistory).run();
  db.delete(schema.dailySnapshots).run();
  db.delete(schema.groupAccounts).run();
  db.delete(schema.accounts).run();
  db.delete(schema.assetCategories).run();
  db.delete(schema.institutionCategories).run();
  db.delete(schema.groups).run();
}

/** テスト終了時のクリーンアップ */
export function closeTestDb(db: Database): void {
  // SAFETY: drizzle の BetterSQLite3Database は内部インスタンスを $client に保持する（型定義には無い。apps/web/src/lib/data.ts と同様）
  const sqlite = (db as unknown as { $client: BetterSqlite3.Database }).$client;
  sqlite.close();
}

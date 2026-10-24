/**
 * 旧世代 transactions 掃除スクリプトの安全弁テスト。
 * 一時 SQLite（実 schema を migrate 済み）で「対象口座だけ消える」「--dry-run では消えない」を担保する。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.js";
import { fixFallbackTransactions } from "../src/scripts/fix-fallback-transactions.js";

type DB = BetterSQLite3Database<typeof schema>;

const here = fileURLToPath(new URL("..", import.meta.url));
const dirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "fix-fallback-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

/** 実 schema を適用した一時 DB に、対象口座（イオン銀行相当）と他口座の行を作る */
function seed(path: string): DB {
  const sqlite = new BetterSqlite3(path);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: `${here}/drizzle` });
  sqlite
    .prepare("INSERT INTO accounts (id, name, institution, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("ion", "イオン銀行 ( 本サイト ) 007*******", "イオン銀行", "bank", "2026-10-01", "2026-10-01");
  sqlite
    .prepare("INSERT INTO accounts (id, name, institution, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("sbi", "SBI新生銀行 ( 本サイト ) 300************", "SBI新生銀行", "bank", "2026-10-01", "2026-10-01");

  const insertTx = sqlite.prepare(
    "INSERT INTO transactions (external_id, account_id, date, description, amount, type, is_transfer, is_excluded_from_calculation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
  );
  for (let i = 0; i < 3; i++) {
    insertTx.run(null, "ion", `2026-10-0${i + 1}`, `旧行${i}`, 1000, "income", "2026-10-01", "2026-10-01");
  }
  insertTx.run("kept-1", "sbi", "2026-10-05", "新行", 5000, "income", "2026-10-01", "2026-10-01");

  sqlite
    .prepare(
      "INSERT INTO holdings (account_id, name, quantity, value, scraped_at, liability_category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("sbi", "ご利用残高", 1, 1000, "2026-10-01", "負債", "2026-10-01", "2026-10-01");
  // T024 以降の負債行（type='liability'）。liability_category は将来の負債内訳の実データなので消してはならない
  sqlite
    .prepare(
      "INSERT INTO holdings (account_id, name, type, quantity, value, scraped_at, liability_category, created_at, updated_at) VALUES (?, ?, 'liability', ?, ?, ?, ?, ?, ?)",
    )
    .run("sbi", "カード未払", 1, 5000, "2026-10-01", "カード", "2026-10-01", "2026-10-01");

  sqlite.close();
  return db;
}

function rawCount(path: string, sql: string): number {
  const sqlite = new BetterSqlite3(path);
  try {
    return sqlite.prepare(sql).pluck().get() as number;
  } finally {
    sqlite.close();
  }
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("fixFallbackTransactions", () => {
  it("--dry-run（既定）では件数を返すだけで 1 行も消さず、liability_category も触らない", () => {
    const path = tempDbPath();
    seed(path);

    const report = fixFallbackTransactions(path, "ion");

    expect(report).toEqual({
      accountId: "ion",
      accountName: "イオン銀行 ( 本サイト ) 007*******",
      transactionRows: 3,
      nullExternalIdRows: 3,
      // type='asset' の 1 行だけ（type='liability' の行は対象外）
      holdingsLiabilityRows: 1,
      applied: false,
      abortedReason: null,
    });
    expect(rawCount(path, "SELECT COUNT(*) FROM transactions")).toBe(4);
    expect(rawCount(path, "SELECT COUNT(*) FROM holdings WHERE liability_category IS NOT NULL")).toBe(2);
  });

  it("--apply で対象口座の行だけ消え、他口座の行が残る（liability_category は NULL 化）", () => {
    const path = tempDbPath();
    seed(path);

    const report = fixFallbackTransactions(path, "ion", { apply: true });
    expect(report.applied).toBe(true);

    expect(rawCount(path, "SELECT COUNT(*) FROM transactions WHERE account_id = 'ion'")).toBe(0);
    expect(rawCount(path, "SELECT COUNT(*) FROM transactions WHERE account_id = 'sbi'")).toBe(1);
    expect(rawCount(path, "SELECT COUNT(*) FROM transactions WHERE external_id = 'kept-1'")).toBe(1);
    // type='asset' の行だけ NULL 化され、type='liability' の行の値は残る
    expect(
      rawCount(path, "SELECT COUNT(*) FROM holdings WHERE type = 'asset' AND liability_category IS NOT NULL"),
    ).toBe(0);
    expect(
      rawCount(path, "SELECT COUNT(*) FROM holdings WHERE type = 'liability' AND liability_category = 'カード'"),
    ).toBe(1);
    // holdings の行自体は消さない（列だけ NULL に戻す）
    expect(rawCount(path, "SELECT COUNT(*) FROM holdings")).toBe(2);
  });

  it("存在しない account_id + --apply では 1 行も変更せず applied: false（holdings も触らない）", () => {
    const path = tempDbPath();
    seed(path);

    const report = fixFallbackTransactions(path, "typo-account", { apply: true });

    expect(report.applied).toBe(false);
    expect(report.accountName).toBeNull();
    expect(report.abortedReason).toContain("存在しない");
    expect(rawCount(path, "SELECT COUNT(*) FROM transactions")).toBe(4);
    expect(rawCount(path, "SELECT COUNT(*) FROM holdings WHERE liability_category IS NOT NULL")).toBe(2);
  });

  it("旧世代行と現行行が混在する口座は --apply でも中断する（現行行を消さない）", () => {
    const path = tempDbPath();
    const db = seed(path);
    void db;
    const sqlite = new BetterSqlite3(path);
    // イオン銀行に現行パーサ由来の行（external_id あり）を 1 行足して混在させる
    sqlite
      .prepare(
        "INSERT INTO transactions (external_id, account_id, date, description, amount, type, is_transfer, is_excluded_from_calculation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
      )
      .run("current-1", "ion", "2026-10-09", "現行行", 700, "income", "2026-10-01", "2026-10-01");
    sqlite.close();

    const report = fixFallbackTransactions(path, "ion", { apply: true });

    expect(report.applied).toBe(false);
    expect(report.abortedReason).toContain("混在");
    expect(rawCount(path, "SELECT COUNT(*) FROM transactions WHERE account_id = 'ion'")).toBe(4);
    expect(rawCount(path, "SELECT COUNT(*) FROM holdings WHERE liability_category IS NOT NULL")).toBe(2);
  });
});

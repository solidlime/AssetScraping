import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, schema, type Database } from "../src/index.js";
import { getAccountAlerts, type AccountAlert } from "../src/repositories/alerts.js";
import { SETTING_KEYS, setSetting } from "../src/repositories/settings.js";

let db: Database;

/** 口座 + 最新ステータスを投入するヘルパ */
function seedAccount(id: string, name: string, institution: string, balance: number, status: string | null = "ok"): void {
  const ts = new Date().toISOString();
  db.insert(schema.accounts)
    .values({ id, name, institution, category: "bank", createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({ target: schema.accounts.id, set: { name, updatedAt: ts } })
    .run();
  db.insert(schema.accountStatuses)
    .values({ accountId: id, balance, scrapedAt: ts, status, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({ target: schema.accountStatuses.accountId, set: { balance, status, updatedAt: ts } })
    .run();
}

beforeEach(() => {
  db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

describe("getAccountAlerts", () => {
  it("しきい値以下の口座を low_balance として返す", () => {
    seedAccount("acc-1", "青空銀行", "青空銀行", 99_999);
    seedAccount("acc-2", "証券会社", "証券会社", 100_001);
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts).toEqual([
      { kind: "low_balance", accountId: "acc-1", accountName: "青空銀行", institution: "青空銀行", balance: 99_999, status: "ok" },
    ]);
  });

  it("しきい値ちょうど・負残高も low_balance（本家 <= 判定踏襲）", () => {
    seedAccount("acc-eq", "ちょうど口座", "銀行", 100_000);
    seedAccount("acc-neg", "マイナス口座", "カード", -5_000);
    const kinds = new Map(
      getAccountAlerts(db, { threshold: 100_000 }).map((a: AccountAlert) => [a.accountId, a.kind]),
    );
    expect(kinds.get("acc-eq")).toBe("low_balance");
    expect(kinds.get("acc-neg")).toBe("low_balance");
  });

  it("エラー・更新中・停止口座を account_status として返す（残高しきい値以上でも）", () => {
    seedAccount("acc-err", "エラー口座", "銀行", 500_000, "error");
    seedAccount("acc-upd", "更新中口座", "銀行", 500_000, "updating");
    seedAccount("acc-sus", "停止中口座", "銀行", 500_000, "suspended");
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    const kinds = new Map(alerts.map((a) => [a.accountId, a.kind]));
    expect(kinds.get("acc-err")).toBe("account_status");
    expect(kinds.get("acc-upd")).toBe("account_status");
    expect(kinds.get("acc-sus")).toBe("account_status");
  });

  it("両方該当の口座は重複せず 1 件（low_balance 優先）", () => {
    seedAccount("acc-both", "両方口座", "銀行", 50_000, "error");
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe("low_balance");
  });

  it("kind ソート: low_balance → account_status、同種内は残高昇順", () => {
    seedAccount("acc-a", "A", "銀行", 80_000);
    seedAccount("acc-b", "B", "銀行", 10_000);
    seedAccount("acc-err", "E", "銀行", 900_000, "error");
    seedAccount("acc-upd", "U", "銀行", 100, "updating");
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts.map((a) => a.accountId)).toEqual(["acc-upd", "acc-b", "acc-a", "acc-err"]);
  });

  it("threshold 未指定は DB 設定値から既定値が使われる", () => {
    seedAccount("acc-1", "A", "銀行", 99_999);
    expect(getAccountAlerts(db)).toEqual([
      { kind: "low_balance", accountId: "acc-1", accountName: "A", institution: "銀行", balance: 99_999, status: "ok" },
    ]);
  });

  it("ステータス unknown な行は low_balance のみで返す（unknown 自体は警告しない）", () => {
    seedAccount("acc-u", "A", "銀行", 0, null);
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe("low_balance");
  });

  it("threshold 設定省略時に low_balance_threshold 設定キーを参照する", () => {
    setSetting(db, SETTING_KEYS.lowBalanceThreshold, "42");
    seedAccount("acc-1", "A", "銀行", 43);
    expect(getAccountAlerts(db)).toHaveLength(0); // 43 > 42 は非対象
    seedAccount("acc-2", "B", "銀行", 42);
    const alerts = getAccountAlerts(db);
    expect(alerts).toHaveLength(1); // 42 <= 42
    expect(alerts[0]?.kind).toBe("low_balance");
  });
});

// upsertAccountStatus が shared AccountStatus の status/statusText を反映することの検証。
// （b48e7f6 で追加された shared 語彙の結線。ハードコード "ok" からの脱却）
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, schema, type Database } from "../src/index.js";
import { upsertAccountStatus } from "../src/repo.js";
import { getAccountAlerts } from "../src/repositories/alerts.js";
import { setLowBalanceThreshold } from "../src/repositories/settings.js";

let db: Database;

beforeEach(() => {
  db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

function seedAccount(id: string): void {
  const ts = new Date().toISOString();
  db.insert(schema.accounts)
    .values({ id, name: `口座${id}`, institution: "テスト銀行", category: "bank", createdAt: ts, updatedAt: ts })
    .run();
}

describe("upsertAccountStatus: shared status/statusText の反映", () => {
  it("status 未指定（正常系）は従来どおり ok で保存する", () => {
    seedAccount("a1");
    upsertAccountStatus(db, { accountId: "a1", balance: 500_000, scrapedAt: "2026-10-10T00:00:00Z" });

    const row = db.select().from(schema.accountStatuses).all().find((r) => r.accountId === "a1");
    expect(row?.status).toBe("ok");
    expect(row?.errorMessage).toBeNull();
  });

  it("status: \"error\" + statusText を渡すとそのまま保存され、getAccountAlerts に載る", () => {
    seedAccount("a2");
    upsertAccountStatus(db, {
      accountId: "a2",
      balance: 0,
      scrapedAt: "2026-10-10T00:00:00Z",
      status: "error",
      statusText: "接続エラー",
    });

    const row = db.select().from(schema.accountStatuses).all().find((r) => r.accountId === "a2");
    expect(row?.status).toBe("error");
    expect(row?.errorMessage).toBe("接続エラー");

    setLowBalanceThreshold(db, 0);
    const alerts = getAccountAlerts(db);
    const target = alerts.find((a) => a.accountId === "a2");
    // 両方該当（balance 0 ≦ しきい値 0 + status error）は low_balance 優先の仕様。
    // status 単独の警告挙動は account-alerts.test.ts を参照。
    expect(target?.kind).toBe("low_balance");
    expect(alerts.some((a) => a.accountId === "a2")).toBe(true);
  });

  it("2 回目に status を外して更新すると ok に戻る（失効回復）", () => {
    seedAccount("a3");
    upsertAccountStatus(db, {
      accountId: "a3",
      balance: 10_000,
      scrapedAt: "2026-10-10T00:00:00Z",
      status: "updating",
    });
    upsertAccountStatus(db, { accountId: "a3", balance: 20_000, scrapedAt: "2026-10-10T01:00:00Z" });

    const row = db.select().from(schema.accountStatuses).all().find((r) => r.accountId === "a3");
    expect(row?.status).toBe("ok");
    expect(row?.errorMessage).toBeNull();
  });
});

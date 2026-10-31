import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, schema, type Database } from "../src/index.js";
import {
  createScheduledPayment,
  deleteScheduledPayment,
  listScheduledPayments,
  updateScheduledPayment,
  validateScheduledPayment,
  type ScheduledPaymentInput,
} from "../src/repositories/scheduled-payments.js";

let db: Database;

beforeEach(() => {
  db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

function seedAccount(id: string, name: string, category = "bank"): void {
  const ts = new Date().toISOString();
  db.insert(schema.accounts).values({ id, name, institution: name, category, createdAt: ts, updatedAt: ts }).run();
}

const input = (over: Partial<ScheduledPaymentInput> = {}): ScheduledPaymentInput => ({
  name: "家賃",
  amount: 80_000,
  withdrawalDay: 27,
  withdrawalAccountId: "bank-1",
  ...over,
});

describe("scheduled_payments CRUD", () => {
  beforeEach(() => seedAccount("bank-1", "青空銀行"));

  it("createScheduledPayment は UUID と isActive 既定 true で作る", () => {
    const created = createScheduledPayment(db, input());
    expect(created).toMatchObject({
      name: "家賃",
      amount: 80_000,
      withdrawalDay: 27,
      withdrawalAccountId: "bank-1",
      isActive: true,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(listScheduledPayments(db)).toHaveLength(1);
  });

  it("listScheduledPayments は引き落とし日昇順・activeOnly で絞る", () => {
    createScheduledPayment(db, input({ name: "電気代", withdrawalDay: 15, amount: 5_000 }));
    createScheduledPayment(db, input({ name: "家賃", withdrawalDay: 27, amount: 80_000 }));
    createScheduledPayment(db, input({ name: "解約済み", withdrawalDay: 1, amount: 1_000, isActive: false }));

    expect(listScheduledPayments(db).map((p) => p.name)).toEqual(["解約済み", "電気代", "家賃"]);
    expect(listScheduledPayments(db, { activeOnly: true }).map((p) => p.name)).toEqual(["電気代", "家賃"]);
  });

  it("updateScheduledPayment は id と createdAt を保ったまま更新する", () => {
    const created = createScheduledPayment(db, input());
    const updated = updateScheduledPayment(db, created.id, input({ name: "家賃（改定）", amount: 85_000, isActive: false }));
    expect(updated).toMatchObject({ id: created.id, name: "家賃（改定）", amount: 85_000, isActive: false });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(listScheduledPayments(db)).toHaveLength(1);
  });

  it("updateScheduledPayment は不明 id で throw する", () => {
    expect(() => updateScheduledPayment(db, "nope", input())).toThrow(/見つかりません/);
  });

  it("deleteScheduledPayment は 1 回目 true、2 回目 false", () => {
    const created = createScheduledPayment(db, input());
    expect(deleteScheduledPayment(db, created.id)).toBe(true);
    expect(deleteScheduledPayment(db, created.id)).toBe(false);
    expect(listScheduledPayments(db)).toHaveLength(0);
  });
});

describe("validateScheduledPayment", () => {
  beforeEach(() => {
    seedAccount("bank-1", "青空銀行");
    seedAccount("card-1", "カード", "card");
  });

  it("正常系は trim 済みの名称と isActive 既定 true を返す", () => {
    expect(validateScheduledPayment(db, { ...input(), name: "  家賃  " })).toEqual({
      name: "家賃",
      amount: 80_000,
      withdrawalDay: 27,
      withdrawalAccountId: "bank-1",
      isActive: true,
    });
  });

  it("銀行以外のカテゴリでも口座が実在すれば通る（口座から落ちる例がある）", () => {
    expect(validateScheduledPayment(db, input({ withdrawalAccountId: "card-1" })).withdrawalAccountId).toBe("card-1");
  });

  it("name: 空・空白のみ・51 文字は throw、50 文字は通る", () => {
    expect(() => validateScheduledPayment(db, input({ name: "" }))).toThrow(/名称/);
    expect(() => validateScheduledPayment(db, input({ name: "   " }))).toThrow(/名称/);
    expect(() => validateScheduledPayment(db, input({ name: "あ".repeat(51) }))).toThrow(/50 文字/);
    expect(validateScheduledPayment(db, input({ name: "あ".repeat(50) })).name).toHaveLength(50);
  });

  it("amount: 0・負・小数・上限超は throw、上限ちょうどは通る", () => {
    expect(() => validateScheduledPayment(db, input({ amount: 0 }))).toThrow(/金額/);
    expect(() => validateScheduledPayment(db, input({ amount: -1 }))).toThrow(/金額/);
    expect(() => validateScheduledPayment(db, input({ amount: 1.5 }))).toThrow(/金額/);
    expect(() => validateScheduledPayment(db, input({ amount: 100_000_001 }))).toThrow(/金額/);
    expect(validateScheduledPayment(db, input({ amount: 100_000_000 })).amount).toBe(100_000_000);
  });

  it("withdrawalDay: 0・32・小数は throw、1 と 31 は通る", () => {
    expect(() => validateScheduledPayment(db, input({ withdrawalDay: 0 }))).toThrow(/引き落とし日/);
    expect(() => validateScheduledPayment(db, input({ withdrawalDay: 32 }))).toThrow(/引き落とし日/);
    expect(() => validateScheduledPayment(db, input({ withdrawalDay: 15.5 }))).toThrow(/引き落とし日/);
    expect(validateScheduledPayment(db, input({ withdrawalDay: 1 })).withdrawalDay).toBe(1);
    expect(validateScheduledPayment(db, input({ withdrawalDay: 31 })).withdrawalDay).toBe(31);
  });

  it("存在しない口座は throw", () => {
    expect(() => validateScheduledPayment(db, input({ withdrawalAccountId: "nope" }))).toThrow(/存在しません/);
  });

  it("isActive が boolean 以外なら throw", () => {
    expect(() => validateScheduledPayment(db, input({ isActive: "yes" as unknown as boolean }))).toThrow(/isActive/);
  });

  it("オブジェクト以外・配列は throw", () => {
    expect(() => validateScheduledPayment(db, null)).toThrow();
    expect(() => validateScheduledPayment(db, [])).toThrow();
    expect(() => validateScheduledPayment(db, "家賃")).toThrow();
  });
});

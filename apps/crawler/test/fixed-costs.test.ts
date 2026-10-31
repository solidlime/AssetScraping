import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, createTestDb, resetTestDb } from "@asset-scraping/db/test-helpers";
import { accounts, listScheduledPayments, schema, type Database } from "@asset-scraping/db";
import { handleFixedCosts } from "../src/server.js";

const db: Database = createTestDb();

afterAll(() => closeTestDb(db));

function seedAccount(id: string, name: string, category = "bank"): void {
  const ts = new Date().toISOString();
  db.insert(accounts).values({ id, name, institution: name, category, createdAt: ts, updatedAt: ts }).run();
}

const body = (over: Record<string, unknown> = {}) => ({
  name: "家賃",
  amount: 80_000,
  withdrawalDay: 27,
  withdrawalAccountId: "bank-a",
  ...over,
});

beforeEach(() => {
  resetTestDb(db);
  // resetTestDb は scheduled_payments を消さないので明示的にクリアする
  db.delete(schema.scheduledPayments).run();
  seedAccount("bank-a", "銀行A");
  seedAccount("bank-b", "銀行B");
});

describe("GET /fixed-costs", () => {
  it("空なら空配列、作成後は一覧を返す", () => {
    expect(handleFixedCosts(db, "GET", {})).toEqual({ status: 200, body: { ok: true, payments: [] } });

    const created = handleFixedCosts(db, "POST", body());
    const listed = handleFixedCosts(db, "GET", {});
    expect(listed.status).toBe(200);
    expect((listed.body as { payments: { name: string }[] }).payments).toHaveLength(1);
    expect((listed.body as { payments: { name: string }[] }).payments[0]?.name).toBe("家賃");
    expect(created.status).toBe(201);
  });
});

describe("POST /fixed-costs", () => {
  it("検証済みの固定費を作って 201 で返す", () => {
    const outcome = handleFixedCosts(db, "POST", body({ name: "  家賃  " }));
    expect(outcome.status).toBe(201);
    expect(outcome.body).toMatchObject({
      ok: true,
      payment: {
        name: "家賃",
        amount: 80_000,
        withdrawalDay: 27,
        withdrawalAccountId: "bank-a",
        isActive: true,
      },
    });
    expect(listScheduledPayments(db)).toHaveLength(1);
  });

  it("バリデーションエラーは 400 { ok:false, error }", () => {
    for (const invalid of [
      body({ name: "" }),
      body({ amount: 0 }),
      body({ amount: 100_000_001 }),
      body({ withdrawalDay: 32 }),
      body({ withdrawalAccountId: "nope" }),
      body({ isActive: "yes" }),
    ]) {
      const outcome = handleFixedCosts(db, "POST", invalid);
      expect(outcome.status).toBe(400);
      expect(outcome.body).toMatchObject({ ok: false });
      expect((outcome.body as { error: string }).error).toBeTruthy();
    }
    expect(listScheduledPayments(db)).toHaveLength(0);
  });
});

describe("PUT /fixed-costs", () => {
  it("id を指定して更新する", () => {
    const created = handleFixedCosts(db, "POST", body());
    const id = (created.body as { payment: { id: string } }).payment.id;

    const outcome = handleFixedCosts(db, "PUT", body({ id, name: "家賃（改定）", amount: 85_000, isActive: false }));
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ ok: true, payment: { id, name: "家賃（改定）", amount: 85_000, isActive: false } });
    expect(listScheduledPayments(db)).toHaveLength(1);
  });

  it("存在しない id は 404（1件も書かない）", () => {
    const outcome = handleFixedCosts(db, "PUT", body({ id: "nope" }));
    expect(outcome.status).toBe(404);
    expect(outcome.body).toMatchObject({ ok: false });
    expect(listScheduledPayments(db)).toHaveLength(0);
  });

  it("id が無ければ 400", () => {
    expect(handleFixedCosts(db, "PUT", body()).status).toBe(400);
  });
});

describe("DELETE /fixed-costs", () => {
  it("id を指定して削除する", () => {
    const created = handleFixedCosts(db, "POST", body());
    const id = (created.body as { payment: { id: string } }).payment.id;

    expect(handleFixedCosts(db, "DELETE", { id })).toEqual({ status: 200, body: { ok: true } });
    expect(listScheduledPayments(db)).toHaveLength(0);
    // 2 回目は 404
    expect(handleFixedCosts(db, "DELETE", { id }).status).toBe(404);
  });

  it("id が無ければ 400", () => {
    expect(handleFixedCosts(db, "DELETE", {}).status).toBe(400);
  });
});

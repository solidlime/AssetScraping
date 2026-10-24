import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, createTestDb, resetTestDb } from "@asset-scraping/db/test-helpers";
import { accounts, accountStatuses, type Database } from "@asset-scraping/db";
import { applySettingsUpdate, settingsPayload } from "../src/server.js";

const db: Database = createTestDb();

afterAll(() => closeTestDb(db));

function seedAccount(id: string, name: string, category: string): void {
  const ts = new Date().toISOString();
  db.insert(accounts)
    .values({ id, name, institution: name, category, createdAt: ts, updatedAt: ts })
    .run();
}

function linkOf(cardId: string): string | null {
  const row = db.select().from(accounts).where(eq(accounts.id, cardId)).get();
  return row?.withdrawalAccountId ?? null;
}

beforeEach(() => {
  resetTestDb(db);
  seedAccount("bank-a", "銀行A", "bank");
  seedAccount("bank-b", "銀行B", "bank");
  seedAccount("card-1", "カード1", "card");
  seedAccount("card-2", "カード2", "card");
});

describe("settingsPayload", () => {
  it("全カードの withdrawalAccountId をカード名付きで列挙する（未設定は null）", () => {
    db.update(accounts).set({ withdrawalAccountId: "bank-a" }).where(eq(accounts.id, "card-1")).run();
    const payload = settingsPayload(db) as {
      cardWithdrawalLinks: { cardAccountId: string; cardName: string; withdrawalAccountId: string | null }[];
    };
    expect(payload.cardWithdrawalLinks).toEqual(
      expect.arrayContaining([
        { cardAccountId: "card-1", cardName: "カード1", withdrawalAccountId: "bank-a" },
        { cardAccountId: "card-2", cardName: "カード2", withdrawalAccountId: null },
      ]),
    );
    expect(payload.cardWithdrawalLinks).toHaveLength(2);
  });
});

describe("applySettingsUpdate の cardWithdrawalLinks", () => {
  it("カードごとに設定できる（部分更新: 未出現キーは既存値を保持）", () => {
    applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "bank-a", "card-2": "bank-b" } });
    expect([linkOf("card-1"), linkOf("card-2")]).toEqual(["bank-a", "bank-b"]);

    applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "bank-b" } });
    expect([linkOf("card-1"), linkOf("card-2")]).toEqual(["bank-b", "bank-b"]);
  });

  it("null は解除（列を NULL にする）", () => {
    applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "bank-a" } });
    applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": null } });
    expect(linkOf("card-1")).toBeNull();
  });

  it("カード以外をキーに指定すると throw", () => {
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: { "bank-a": "bank-b" } })).toThrow(/カード/);
  });

  it("存在しない口座をキーに指定すると throw", () => {
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: { nope: "bank-a" } })).toThrow(/存在しない/);
  });

  it("カードを値に指定すると throw（カード→カードの紐付けを拒否）", () => {
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "card-2" } })).toThrow(
      /引き落とし口座/,
    );
  });

  it("自分自身を指すと throw", () => {
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "card-1" } })).toThrow();
  });

  it("存在しない口座を値に指定すると throw", () => {
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "nope" } })).toThrow(/存在しない/);
  });

  it("文字列でも null でもない値は throw", () => {
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": 1 } })).toThrow(/文字列か null/);
  });

  it("オブジェクト以外は throw", () => {
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: [] })).toThrow();
  });

  // M1: 検証と書込を分離（検証エラー時に 1 件も書かれない）
  it("途中のキーが不正なら、先行キーも含めて 1 件も書かない", () => {
    expect(() =>
      applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "bank-a", "card-2": "no-such" } }),
    ).toThrow(/存在しない/);
    expect(linkOf("card-1")).toBeNull();
    expect(linkOf("card-2")).toBeNull();
  });

  // M1: 検証は全フィールドを先に済ませる（cardWithdrawalLinks の不正で他の設定も確定しない）
  it("他のフィールドと併記しても、不正な cardWithdrawalLinks があるとどの設定も書かない", () => {
    expect(() =>
      applySettingsUpdate(db, {
        scheduledRefreshTime: "07:00",
        lowBalanceThreshold: 55_000,
        withdrawalAlertDays: 14,
        cardWithdrawalLinks: { "card-1": "no-such" },
      }),
    ).toThrow(/存在しない/);
    expect(settingsPayload(db)).toMatchObject({
      scheduledRefreshTime: "06:00",
      lowBalanceThreshold: 100_000,
      withdrawalAlertDays: 7,
    });
  });

  // M2: 解決側でカード扱いされる行（予定額を持つ行）は引き落とし口座にできない
  it("予定額を持つ行は値に指定できない（category='bank' でも拒否）", () => {
    const ts = new Date().toISOString();
    db.insert(accountStatuses)
      .values({
        accountId: "bank-b",
        balance: 10_000,
        scrapedAt: ts,
        status: "ok",
        scheduledWithdrawalAmount: 50_000,
        scheduledWithdrawalDate: "2025-01-10",
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    expect(() => applySettingsUpdate(db, { cardWithdrawalLinks: { "card-1": "bank-b" } })).toThrow(
      /カード/,
    );
    expect(linkOf("card-1")).toBeNull();
  });
});

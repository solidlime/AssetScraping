/**
 * 本家 mf-dashboard seed/accounts.ts institutionCategoryDefs 移植の roundtrip テスト。
 * ensureInstitutionCategories（冪等 seed）と assignAccountCategories（accounts.category_id
 * 自動割当）が crawler 由来の口座行に対して通ることを担保する。
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../src/schema.ts";
import { closeTestDb, createTestDb, resetTestDb } from "../src/test-helpers.ts";
import {
  INSTITUTION_CATEGORY_DEFS,
  assignAccountCategories,
  ensureInstitutionCategories,
  guessInstitutionCategory,
  upsertAccount,
  type Database,
} from "../src/repo.ts";

const dbs: Database[] = [];

function freshDb(): Database {
  const db = createTestDb();
  dbs.push(db);
  return db;
}

afterAll(() => {
  for (const db of dbs) closeTestDb(db);
});

describe("ensureInstitutionCategories（本家 seed 移植）", () => {
  it("本家 institutionCategoryDefs（銀行〜貯蓄）+ その他 を displayOrder 順に seed する", () => {
    const db = freshDb();
    resetTestDb(db);

    ensureInstitutionCategories(db);

    const rows = db
      .select()
      .from(schema.institutionCategories)
      .orderBy(schema.institutionCategories.displayOrder)
      .all();
    const names = rows.map((r) => r.name);
    for (const def of INSTITUTION_CATEGORY_DEFS) {
      expect(names).toContain(def.name);
    }
    expect(rows.map((r) => r.displayOrder)).toEqual(
      [...rows.map((r) => r.displayOrder)].sort((a, b) => (a ?? 0) - (b ?? 0)),
    );
    expect(rows[0]).toMatchObject({ name: "銀行", displayOrder: 1 });
    expect(names).toContain("その他");
    expect(rows).toHaveLength(INSTITUTION_CATEGORY_DEFS.length + 1);
  });

  it("再実行で二重登録しない（冪等）", () => {
    const db = freshDb();
    resetTestDb(db);

    ensureInstitutionCategories(db);
    ensureInstitutionCategories(db);

    const rows = db.select().from(schema.institutionCategories).all();
    const names = rows.map((r) => r.name);
    for (const def of INSTITUTION_CATEGORY_DEFS) {
      expect(names).toContain(def.name);
    }
    // 本家 defs + その他 = 11 行
  });
});

describe("guessInstitutionCategory（内容ベース推定）", () => {
  it("実測 16 口座の金融機関名を正しいカテゴリ名に写像する", () => {
    expect(guessInstitutionCategory("イオン銀行")).toBe("銀行");
    expect(guessInstitutionCategory("北陸労働金庫")).toBe("銀行");
    expect(guessInstitutionCategory("ドコモＳＭＴＢネット銀行")).toBe("銀行");
    expect(guessInstitutionCategory("楽天証券")).toBe("証券");
    expect(guessInstitutionCategory("SBI証券")).toBe("証券");
    expect(guessInstitutionCategory("Coincheck")).toBe("暗号資産・FX・貴金属");
    expect(guessInstitutionCategory("Zaif")).toBe("暗号資産・FX・貴金属");
    expect(guessInstitutionCategory("NRK(確定拠出年金)")).toBe("年金");
    expect(guessInstitutionCategory("メルペイ（残高払い）")).toBe("電子マネー・プリペイド");
    expect(guessInstitutionCategory("モバイルSuica")).toBe("電子マネー・プリペイド");
    expect(guessInstitutionCategory("楽天市場(my Rakuten)")).toBe("ポイント");
  });

  it("判定不能な金融機関は null（呼び出し側で「その他」へフォールバック）", () => {
    expect(guessInstitutionCategory("SBIベネフィットシステムズ")).toBeNull();
    expect(guessInstitutionCategory("")).toBeNull();
  });
});

describe("assignAccountCategories（category_id 自動割当）", () => {
  it("category_id が null の口座だけを埋め、未分類は「その他」に割当する", () => {
    const db = freshDb();
    resetTestDb(db);

    upsertAccount(db, { id: "a1", name: "楽天証券", institution: "楽天証券", category: "securities" });
    upsertAccount(db, { id: "a2", name: "NRK(確定拠出年金)", institution: "NRK(確定拠出年金)", category: "pension" });
    upsertAccount(db, { id: "a3", name: "SBIベネフィット", institution: "SBIベネフィットシステムズ", category: "other" });

    ensureInstitutionCategories(db);
    const assigned = assignAccountCategories(db);
    expect(assigned).toBe(3);

    const byId = new Map(
      db
        .select({
          id: schema.accounts.id,
          categoryId: schema.accounts.categoryId,
        })
        .from(schema.accounts)
        .all()
        .map((r) => {
          return [r.id, r.categoryId] as const;
        }),
    );
    const catName = (id: number | null): string | null =>
      id === null
        ? null
        : (db
            .select({ name: schema.institutionCategories.name })
            .from(schema.institutionCategories)
            .where(eq(schema.institutionCategories.id, id))
            .get()?.name ?? null);

    expect(catName(byId.get("a1") ?? null)).toBe("証券");
    expect(catName(byId.get("a2") ?? null)).toBe("年金");
    // 判定不能は「その他」— bs の集計から漏れさせない
    expect(catName(byId.get("a3") ?? null)).toBe("その他");
  });

  it("既存の category_id は保持し、再実行でも二重割当しない（冪等）", () => {
    const db = freshDb();
    resetTestDb(db);

    upsertAccount(db, { id: "a1", name: "楽天証券", institution: "楽天証券", category: "securities" });
    ensureInstitutionCategories(db);
    expect(assignAccountCategories(db)).toBe(1);
    expect(assignAccountCategories(db)).toBe(0);

    const row = db
      .select({ categoryId: schema.accounts.categoryId })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, "a1"))
      .get();
    expect(row?.categoryId).not.toBeNull();
  });
});

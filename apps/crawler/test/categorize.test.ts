/**
 * crawler 側カテゴリ推定（packages/shared/categorize.ts）のテスト。
 * ssnb /cf に大項目・中項目が無い場合、本家 seed のカテゴリ体系
 * （収入 / 食費 / 日用品 / 税・社会保障 / その他 等）で内容ベース分類する。
 * cf のカテゴリ内訳が「その他ばかり」にならないことが目的の最小限実装。
 */
import { describe, expect, it } from "vitest";
import { categorizeTransaction } from "../src/categorize.js";

describe("categorizeTransaction（内容ベース推定）", () => {
  it("本家支出カテゴリ（食費/税・社会保障/趣味・娯楽 等）へ分類する", () => {
    // 実測 descriptions（.data DB 2026-10）
    expect(categorizeTransaction("静岡県沼津市 ラクテンイチバ702520")).toEqual({
      category: "食費",
      subCategory: "食料品",
    });
    expect(categorizeTransaction("鹿児島県曽於市 ラクテンイチバ709098")).toEqual({
      category: "食費",
      subCategory: "食料品",
    });
    expect(categorizeTransaction("VISA国内利用 VS PAYPAL *GOOGLE YO")).toEqual({
      category: "趣味・娯楽",
      subCategory: "その他",
    });
    expect(categorizeTransaction("VISA海外利用 PAYPAL *PATREON INC")).toEqual({
      category: "趣味・娯楽",
      subCategory: "その他",
    });
    expect(categorizeTransaction("VISA国内利用 VS PAYPAL *PIXIVFANB")).toEqual({
      category: "趣味・娯楽",
      subCategory: "その他",
    });
    expect(categorizeTransaction("国税")).toEqual({
      category: "税・社会保障",
      subCategory: "税",
    });
    expect(categorizeTransaction("税引前利息")).toEqual({
      category: "収入",
      subCategory: "利息",
    });
  });

  it("本家 seed の主要カテゴリ別キーワードを分類する", () => {
    expect(categorizeTransaction("給与振込")).toEqual({ category: "収入", subCategory: "給与" });
    expect(categorizeTransaction("東京電力 電気代")).toEqual({
      category: "水道・光熱費",
      subCategory: "電気",
    });
    expect(categorizeTransaction("ソフトバンク料金")).toEqual({
      category: "通信費",
      subCategory: "携帯・電話",
    });
    expect(categorizeTransaction("ユニオン ドラッグ")).toEqual({
      category: "日用品",
      subCategory: "ドラッグストア",
    });
    expect(categorizeTransaction("無印良品 買い物")).toEqual({
      category: "日用品",
      subCategory: "日用品",
    });
    expect(categorizeTransaction("イトーヨーカドー 食料品")).toEqual({
      category: "食費",
      subCategory: "食料品",
    });
    expect(categorizeTransaction("すき家 外食")).toEqual({ category: "食費", subCategory: "外食" });
    expect(categorizeTransaction("スターバックス コーヒー")).toEqual({
      category: "食費",
      subCategory: "カフェ",
    });
    expect(categorizeTransaction("ユニクロ 衣類")).toEqual({
      category: "衣服・美容",
      subCategory: "衣服",
    });
    expect(categorizeTransaction("JR東日本 乗車")).toEqual({
      category: "交通費",
      subCategory: "電車",
    });
    expect(categorizeTransaction("東京メトロ")).toEqual({ category: "交通費", subCategory: "電車" });
    expect(categorizeTransaction("内科 診察")).toEqual({
      category: "健康・医療",
      subCategory: "医療費",
    });
    expect(categorizeTransaction("Udemy 技術書")).toEqual({
      category: "教養・教育",
      subCategory: "書籍",
    });
    expect(categorizeTransaction("国民健康保険料")).toEqual({
      category: "税・社会保障",
      subCategory: "社会保障",
    });
    expect(categorizeTransaction("賃貸料 家賃")).toEqual({ category: "住宅", subCategory: "住居費" });
    expect(categorizeTransaction("楽天カード 引落")).toEqual({
      category: "現金・カード",
      subCategory: "カード引落",
    });
  });

  it("どのキーワードにも当てはまらない説明文は null（分類しない）", () => {
    expect(categorizeTransaction("謎の入金 XYZ")).toBeNull();
    expect(categorizeTransaction("")).toBeNull();
  });
});

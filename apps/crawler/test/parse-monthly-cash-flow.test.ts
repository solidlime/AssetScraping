/**
 * parseMonthlyCashFlow のテスト。
 * 期待値はすべて `.refs/SPEC-cf-monthly.md` の実測表（2026/05〜10）に従う。
 * フィクスチャは実測 HTML（`.refs/cf-monthly.html`）の構造を縮めたもので、
 * 期待値をフィクスチャから逆算しない（実装の写しにしない）ため SPEC 表を独立定数で持つ。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMonthlyCashFlow } from "../src/parse.js";

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] as const;

/** SPEC-cf-monthly.md の実データ表（円） */
const SPEC_INCOME_TOTAL = [636_232, 665_306, 1_371_546, 388_051, 584_477, 16];
const SPEC_EXPENSE_TOTAL = [526_600, 598_709, 977_544, 244_691, 473_209, 1_713];
const SPEC_BALANCE_TOTAL = [109_632, 66_597, 394_002, 143_360, 111_268, -1_697];
/** カテゴリ行（支出）: 行ラベル → 6 か月分（SPEC 表） */
const SPEC_EXPENSE_CATEGORIES: Array<[string, number[]]> = [
  ["食費", [27_632, 28_917, 16_962, 28_981, 60_770, 0]],
  ["日用品", [14_264, 17_835, 6_426, 0, 43_632, 0]],
  ["趣味・娯楽", [13_260, 4_153, 10_071, 4_626, 5_708, 0]],
  ["交際費", [0, 0, 0, 0, 0, 0]],
  ["交通費", [0, 0, 0, 0, 0, 0]],
  ["衣服・美容", [5_550, 2_640, 0, 0, 0, 0]],
  ["健康・医療", [0, 4_960, 0, 0, 0, 0]],
  ["自動車", [10_138, 5_708, 8_486, 40_647, 8_320, 0]],
  ["教養・教育", [55_128, 55_128, 55_128, 55_128, 55_125, 0]],
  ["特別な支出", [0, 0, 0, 0, 0, 0]],
  ["現金・カード", [2_000, 2_000, 3_000, 2_000, 33_000, 0]],
  ["水道・光熱費", [21_673, 24_106, 29_213, 30_410, 7_691, 0]],
  ["通信費", [4_158, 21_721, 6_061, 1_721, 2_572, 90]],
  ["住宅", [302_419, 252_419, 570_681, 52_419, 172_419, 0]],
  ["税・社会保障", [1_289, 12_085, 1_299, 1_296, 1_287, 2]],
  ["保険", [0, 0, 0, 0, 0, 0]],
  ["その他", [5_695, 52_949, 4_477, 1_804, 1_946, 1_621]],
  ["未分類", [63_394, 114_088, 265_740, 25_659, 80_739, 0]],
];

const yen = (n: number) => `${n.toLocaleString("en-US")}円`;

/**
 * 実測 HTML のテーブル構造を再現する（table[1]）。
 * 1 行目 = 月ヘッダ th（先頭に幅指定の空 th）、以降 = <tr class> 付きの行。
 * `収入` 行は `収入合計` と同値を意図的に二重に持たせる（skip の検証）。
 */
function buildFixture(): string {
  const header = ["<th style='width: 150px;'></th>", ...MONTHS.map((m, i) => `<th id='js-th-${i}'>${m.replace("-", "/")}/01〜</th>`)].join("");
  const row = (className: string, label: string, values: number[], cellClass = "number") =>
    `<tr class='${className}'><td class='title'>${label}</td>${values
      .map((v, i) => `<td class='${cellClass}' id='js-${label}-${i}'>${yen(v)}</td>`)
      .join("")}</tr>`;

  return [
    "<table style='margin: 20px 0 0;'><tr><td><a href='/cf/monthly?base_date=2026%2F09%2F29'>prev</a></td></tr></table>",
    "<table>",
    `<tr>${header}</tr>`,
    row("in_sum", "収入合計", SPEC_INCOME_TOTAL),
    row("in", "収入", SPEC_INCOME_TOTAL, "item"),
    row("out_sum", "支出合計", SPEC_EXPENSE_TOTAL),
    ...SPEC_EXPENSE_CATEGORIES.map(([label, values]) => row("out", label, values)),
    row("total", "収支合計", SPEC_BALANCE_TOTAL),
    "</table>",
  ].join("\n");
}

describe("parseMonthlyCashFlow（/cf/monthly の月×カテゴリ行列）", () => {
  it("月ヘッダを YYYY-MM に正規化し、6 か月分を列順で返す", () => {
    const rows = parseMonthlyCashFlow(buildFixture());
    expect(rows.map((r) => r.month)).toEqual([...MONTHS]);
    expect(rows).toHaveLength(6);
  });

  it("全行を保存する（収入 行も kind=income で保持し、行を捨てない）", () => {
    const rows = parseMonthlyCashFlow(buildFixture());
    const may = rows.find((r) => r.month === "2026-05")!;
    expect(may.rows.filter((row) => row.kind === "income").map((row) => [row.name, row.amount])).toEqual([
      ["収入合計", 636_232],
      ["収入", 636_232],
    ]);
  });

  it("合計は `〜合計` 行のみから取るので 収入 が二重計上されない（収入合計=636,232、1,272,464 ではない）", () => {
    const rows = parseMonthlyCashFlow(buildFixture());
    const may = rows.find((r) => r.month === "2026-05")!;
    const incomeTotal = may.rows.find(
      (row) => row.kind === "income" && row.name === "収入合計",
    )!.amount;
    expect(incomeTotal).toBe(636_232);
    // 誤って全 income 行を足すと 2 倍になる（この bug を将来再導入しないための固定）
    const naiveSum = may.rows
      .filter((row) => row.kind === "income")
      .reduce((acc, row) => acc + row.amount, 0);
    expect(naiveSum).toBe(636_232 * 2);
  });

  it("支出合計 は expense、カテゴリ行はそのラベルの expense、収支合計 は kind=balance（派生値）", () => {
    const rows = parseMonthlyCashFlow(buildFixture());
    const may = rows.find((r) => r.month === "2026-05")!;
    expect(may.rows.find((row) => row.name === "支出合計")).toEqual({
      name: "支出合計",
      kind: "expense",
      amount: 526_600,
    });
    expect(may.rows.find((row) => row.name === "食費")).toEqual({
      name: "食費",
      kind: "expense",
      amount: 27_632,
    });
    expect(may.rows.find((row) => row.name === "収支合計")).toEqual({
      name: "収支合計",
      kind: "balance",
      amount: 109_632,
    });
    // 収入・支出は合計行以外に混ざらない
    expect(may.rows.filter((row) => row.kind === "income").map((row) => row.name)).toEqual([
      "収入合計",
      "収入",
    ]);
    expect(may.rows.filter((row) => row.kind === "balance").map((row) => row.name)).toEqual(["収支合計"]);
  });

  it("SPEC の表（収入合計 / 支出合計 / 収支合計）と全月・全値が一致する", () => {
    const rows = parseMonthlyCashFlow(buildFixture());
    const pick = (name: string) =>
      rows.map((r) => r.rows.find((row) => row.name === name)?.amount ?? null);
    expect(pick("収入合計")).toEqual(SPEC_INCOME_TOTAL);
    expect(pick("支出合計")).toEqual(SPEC_EXPENSE_TOTAL);
    expect(pick("収支合計")).toEqual(SPEC_BALANCE_TOTAL);
    for (const [label, values] of SPEC_EXPENSE_CATEGORIES) {
      expect(pick(label), label).toEqual(values);
    }
  });

  it("0円 は 0 として返す（セル欠落にしない）", () => {
    const rows = parseMonthlyCashFlow(buildFixture());
    const oct = rows.find((r) => r.month === "2026-10")!;
    expect(oct.rows.find((row) => row.name === "食費")?.amount).toBe(0);
    expect(oct.rows.find((row) => row.name === "支出合計")?.amount).toBe(1_713);
  });

  it("テーブルも月ヘッダも無い HTML は空配列（throw しない）", () => {
    expect(parseMonthlyCashFlow("<html><body><p>no table</p></body></html>")).toEqual([]);
    expect(parseMonthlyCashFlow("<table><tr><td>ヘッダ無し</td></tr></table>")).toEqual([]);
    expect(parseMonthlyCashFlow("")).toEqual([]);
  });

  it("実 HTML（.refs/cf-monthly.html）で SPEC 表と一致する", () => {
    const html = readFileSync(
      fileURLToPath(new URL("../../../.refs/cf-monthly.html", import.meta.url)),
      "utf8",
    );
    const rows = parseMonthlyCashFlow(html);
    expect(rows.map((r) => r.month)).toEqual([...MONTHS]);
    expect(rows.map((r) => r.rows.find((row) => row.name === "支出合計")?.amount)).toEqual(
      SPEC_EXPENSE_TOTAL,
    );
    expect(rows.map((r) => r.rows.find((row) => row.name === "収入合計")?.amount)).toEqual(
      SPEC_INCOME_TOTAL,
    );
    expect(rows.map((r) => r.rows.find((row) => row.name === "収支合計")?.amount)).toEqual(
      SPEC_BALANCE_TOTAL,
    );
    // 収入 行も保持される（kind=income）
    expect(rows.map((r) => r.rows.find((row) => row.name === "収入")?.amount)).toEqual(
      SPEC_INCOME_TOTAL,
    );
    // 合計行と混同しない
    expect(rows.every((r) => r.rows.some((row) => row.name === "収入"))).toBe(true);
  });
});

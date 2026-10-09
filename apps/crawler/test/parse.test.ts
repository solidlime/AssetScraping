import { describe, expect, it } from "vitest";
import {
  parseAccounts,
  parseDate,
  parseHoldings,
  parseYen,
  parseYenLoose,
} from "../src/parse.js";
import { ScrapeParseError } from "../src/parse.js";

describe("parseYen（円必須）", () => {
  it("円つき金額を数値化する（負値・カンマ対応）", () => {
    expect(parseYen("1,234,567円")).toBe(1234567);
    expect(parseYen("-12,345円")).toBe(-12345);
    expect(parseYen("35円")).toBe(35);
    expect(parseYen("0円")).toBe(0);
  });

  it("「円」が無い入力は null（日付・カレンダー数字の誤爆防止）", () => {
    expect(parseYen("10/08")).toBeNull();
    expect(parseYen("2026-10-08")).toBeNull();
    expect(parseYen("31")).toBeNull();
    expect(parseYen("")).toBeNull();
  });
});

describe("parseYenLoose（円なし許容）", () => {
  it("カンマ区切りの数値をそのまま parse する", () => {
    expect(parseYenLoose("1,234")).toBe(1234);
    expect(parseYenLoose("-22,000\n(振替)")).toBe(-22000);
    expect(parseYenLoose("300,000")).toBe(300000);
    expect(parseYenLoose("0")).toBe(0);
  });

  it("数値を含まないセルは null", () => {
    expect(parseYenLoose("")).toBeNull();
    expect(parseYenLoose("(振替)")).toBeNull();
    expect(parseYenLoose("振替")).toBeNull();
  });
});

describe("parseDate", () => {
  it("YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD を正規化する", () => {
    expect(parseDate("2026-10-09")).toBe("2026-10-09");
    expect(parseDate("2026/10/9")).toBe("2026-10-09");
    expect(parseDate("2026.10.09")).toBe("2026-10-09");
  });

  it("MM/DD(曜) 形式を受ける（年は now の年で補完）", () => {
    expect(parseDate("10/02(金)", new Date(2026, 9, 9))).toBe("2026-10-02");
    expect(parseDate("1/5(月)", new Date(2026, 0, 9))).toBe("2026-01-05");
  });

  it("日付でない文字列は null", () => {
    expect(parseDate("総資産")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseAccounts（/accounts の口座一覧テーブル）", () => {
  const html = `
  <html><body>
  <table>
    <thead><tr><th>金融機関</th><th>資産</th><th>登録日（最終取得日）</th><th>更新状態</th><th>更新</th><th>編集</th><th>削除</th></tr></thead>
    <tbody>
      <tr>
        <td><a href="/accounts/show/IP0DwtoCovpotYPHltPahQ">イオン銀行</a><a href="https://www.aeonbank.co.jp/" target="_blank">本サイト</a> 1234</td>
        <td>1,234,567円</td><td>2026-10-09</td><td>取得済み</td><td><a>更新</a></td><td>編集</td><td>削除</td>
      </tr>
      <tr>
        <td><a href="/accounts/show/AbCdEf12345GHIJ6789">SBI 証券</a><a href="https://www.sbisec.co.jp/" target="_blank">本サイト</a></td>
        <td>46,000,000円</td><td>2026-10-09</td><td>取得済み</td><td>更新</td><td>編集</td><td>削除</td>
      </tr>
      <tr><td><a href="/accounts/new">口座追加</a></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
    </tbody>
  </table>
  </body></html>`;

  it("td[0] の /accounts/show/ リンクから id・名前を、td[1] から残高を取る", () => {
    const accounts = parseAccounts(html);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      id: "IP0DwtoCovpotYPHltPahQ",
      name: "イオン銀行本サイト 1234",
      institution: "イオン銀行",
      category: "bank",
      status: { balance: 1234567 },
    });
    expect(accounts[1]).toMatchObject({
      id: "AbCdEf12345GHIJ6789",
      institution: "SBI 証券",
      category: "securities",
      status: { balance: 46000000 },
    });
    expect(accounts.every((a) => !a.name.includes("口座追加"))).toBe(true);
  });

  it("/accounts/show/ リンクが 1 件も無ければ例外", () => {
    expect(() => parseAccounts("<html><body><p>empty</p></body></html>")).toThrow(ScrapeParseError);
  });
});

describe("parseHoldings（/accounts/show/{id} の「種類・名称」テーブルのみ）", () => {
  const html = `
  <html><body>
  <table><tr><th>口座番号</th><td>1234</td></tr><tr><th>基準日</th><td>2026年10月9日</td></tr></table>
  <table>
    <thead><tr><th>種類・名称</th><th>残高</th></tr></thead>
    <tbody>
      <tr><td>アメシスト支店 普通預金</td><td>35円</td></tr>
      <tr><td>スーパー定期（1年）</td><td>500,000円</td></tr>
      <tr><td>合計</td><td>500,035円</td></tr>
    </tbody>
  </table>
  <table><tr><th>月</th><td>10月</td></tr></table>
  </body></html>`;

  it("種類・名称テーブルの各行を Holding 化する（数量不明は 0、単価・含み損益は null）", () => {
    const holdings = parseHoldings(html, "acc-1");
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({
      accountId: "acc-1",
      name: "アメシスト支店 普通預金",
      quantity: 0,
      value: 35,
      averagePrice: null,
      unrealizedGain: null,
    });
    expect(holdings[1]).toMatchObject({ name: "スーパー定期（1年）", value: 500000 });
  });

  it("種類・名称テーブルが無いページ（tmp 側の情報系テーブルだけ）は空配列", () => {
    expect(parseHoldings("<table><tr><th>月</th><td>10月</td></tr></table>", "acc-1")).toEqual([]);
  });
});

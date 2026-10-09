import { describe, expect, it } from "vitest";
import {
  parseAccounts,
  parseAssetHistory,
  parseDate,
  parseHoldings,
  parseTransactions,
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

  it("pns 形（評価額ヘッダ）テーブルを name=種類・名称 / value=評価額 で parse する（年金・保険口座）", () => {
    const html = `
    <table>
      <thead><tr><th>種類・名称</th><th>平均取得価格</th><th>評価額</th><th>取得価額</th><th>評価損益</th><th>評価損益率</th></tr></thead>
      <tbody>
        <tr><td>eMAXIS Slim バランス(8資産)</td><td>850,000円</td><td>1,004,921円</td><td>800,000円</td><td>204,921円</td><td>25.62%</td></tr>
      </tbody>
    </table>`;
    const holdings = parseHoldings(html, "pension-1");
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      accountId: "pension-1",
      name: "eMAXIS Slim バランス(8資産)",
      value: 1004921,
      averagePrice: 850000,
      unrealizedGain: 204921,
    });
  });

  it("eq 形（株式 10 列）テーブルを残高・数量・平均取得価格列から parse する", () => {
    const html = `
    <table>
      <thead><tr><th>コード</th><th>銘柄</th><th>数量</th><th>平均取得価格</th><th>単価</th><th>残高</th><th>前日比</th><th>含み損益</th><th>含み損益率</th><th>保有金融機関</th></tr></thead>
      <tbody>
        <tr><td>7203</td><td>トヨタ自動車</td><td>100株</td><td>2,493円</td><td>2,814円</td><td>281,400円</td><td>+2,800円</td><td>32,100円</td><td>12.88%</td><td>SBI証券</td></tr>
      </tbody>
    </table>`;
    const holdings = parseHoldings(html, "sec-1");
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      name: "トヨタ自動車",
      value: 281400,
      quantity: 100,
      averagePrice: 2493,
      unrealizedGain: 32100,
    });
  });

  it("「名称」ラベルのテーブルも受け、複数テーブルは合算する", () => {
    const html = `
    <table><tr><th>名称</th><th>残高</th></tr><tr><td>米ドル 現金</td><td>35,713円</td></tr></table>
    <table><tr><th>名称</th><th>残高</th></tr><tr><td>現金（AI投資）</td><td>2,446円</td></tr></table>`;
    const holdings = parseHoldings(html, "sec-2");
    expect(holdings.map((h) => h.name)).toEqual(["米ドル 現金", "現金（AI投資）"]);
    expect(holdings.map((h) => h.value)).toEqual([35713, 2446]);
  });
});

describe("parseAssetHistory（/bs/history の資産推移テーブル）", () => {
  const html = `
  <html><body>
  <table>
    <thead><tr><th>日付</th><th>合計</th><th>預金・現金</th><th>株式(現物)</th><th>投資信託</th><th>債券</th><th>暗号資産</th><th>FX</th><th>年金</th><th>ポイント</th><th>詳細</th></tr></thead>
    <tbody>
      <tr><th>2026-10-09</th><td>46,604,121円</td><td>1,234,567円</td><td>10,000,000円</td><td>25,000,000円</td><td>0円</td><td>1,500,000円</td><td>0円</td><td>8,000,000円</td><td>869,554円</td><td><a href="/bs/history/detail">詳細</a></td></tr>
      <tr><th>2026-10-08</th><td>46,500,000円</td><td>1,234,000円</td><td>10,000,000円</td><td>25,000,000円</td><td>0円</td><td>1,400,000円</td><td>0円</td><td>8,000,000円</td><td>866,000円</td><td><a>詳細</a></td></tr>
    </tbody>
  </table>
  <table><tr><th>グラフ</th><td>...</td></tr></table>
  </body></html>`;

  it("th=日付・td=金額・ヘッダ th からカテゴリを取る（合計・詳細列は skip）", () => {
    const points = parseAssetHistory(html);
    expect(points.filter((p) => p.date === "2026-10-09")).toEqual([
      { date: "2026-10-09", category: "bank", value: 1234567 },
      // 株式(現物) と 投資信託 は同カテゴリ(securities)のため加算
      { date: "2026-10-09", category: "securities", value: 35000000 },
      { date: "2026-10-09", category: "other", value: 0 }, // 債券 + FX（同カテゴリ合算）
      { date: "2026-10-09", category: "crypto", value: 1500000 },
      { date: "2026-10-09", category: "pension", value: 8000000 },
      { date: "2026-10-09", category: "point", value: 869554 },
    ]);
  });

  it("日付列が解釈できない行は skip する", () => {
    expect(parseAssetHistory("<table><tr><th>日付</th><th>預金・現金</th></tr></table>")).toEqual([]);
  });
});

describe("parseTransactions（/cf の取引明細テーブル）", () => {
  const html = `
  <html><body>
  <table><tr><th>口座</th><td>dummy</td></tr></table>
  <table class="table table-hover">
    <thead><tr><th>計算対象</th><th>日付</th><th>内容</th><th>金額（円）</th><th>保有金融機関</th><th>大項目</th><th>中項目</th><th>メモ</th><th>振替</th><th>削除</th></tr></thead>
    <tbody>
      <tr><td><input type="checkbox"></td><td>10/02(金)</td><td>スーパー</td><td>-22,000\n(振替)</td><td>三井住友カード</td><td>食費</td><td>食料品</td><td></td><td><input type="checkbox"></td><td></td></tr>
      <tr><td><input type="checkbox"></td><td>10/05(月)</td><td>給与</td><td>300,000</td><td>イオン銀行</td><td>収入</td><td>給与</td><td></td><td></td><td></td></tr>
      <tr><td><input type="checkbox"></td><td>10/06(火)</td><td>口座間振替</td><td>-50,000\n(振替)</td><td>イオン銀行</td><td></td><td></td><td></td><td><input type="checkbox"></td><td></td></tr>
    </tbody>
  </table>
  <table><tr><th>合計</th><td>228,000円</td></tr></table>
  </body></html>`;

  it("実測列配置（日付=td[1]・内容=td[2]・金額=td[3]・大/中項目）で parse する", () => {
    const txs = parseTransactions(html, "acc-1", new Date(2026, 9, 9));
    expect(txs).toEqual([
      {
        externalId: null,
        accountId: "acc-1",
        date: "2026-10-02",
        description: "スーパー",
        amount: -22000,
        category: "食費 / 食料品",
        subCategory: "食料品",
      },
      {
        externalId: null,
        accountId: "acc-1",
        date: "2026-10-05",
        description: "給与",
        amount: 300000,
        category: "収入 / 給与",
        subCategory: "給与",
      },
      {
        externalId: null,
        accountId: "acc-1",
        date: "2026-10-06",
        description: "口座間振替",
        amount: -50000,
        category: null,
        subCategory: null,
      },
    ]);
  });

  it("table-hover のテーブルが無ければ例外", () => {
    expect(() => parseTransactions("<table><tr><th>日付</th></tr></table>", "acc-1")).toThrow(ScrapeParseError);
  });
});

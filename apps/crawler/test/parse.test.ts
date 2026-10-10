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
      status: { balance: 1234567, status: "ok", statusText: "取得済み" },
    });
    expect(accounts[1]).toMatchObject({
      id: "AbCdEf12345GHIJ6789",
      institution: "SBI 証券",
      category: "securities",
      status: { balance: 46000000, status: "ok" },
    });
    expect(accounts.every((a) => !a.name.includes("口座追加"))).toBe(true);
  });

  it("更新状態列（td[3]）を判定する: 取得済み=ok / エラー系=statusText 付き", () => {
    const statusHtml = `
    <html><body><table><tbody>
      <tr>
        <td><a href="/accounts/show/IDokokokokokokokokok1">正常口座</a></td>
        <td>500,000円</td><td>2026-10-10</td><td>取得済み</td><td>更新</td><td>編集</td><td>削除</td>
      </tr>
      <tr>
        <td><a href="/accounts/show/IDngngngngngngngngng2">エラー口座</a></td>
        <td>0円</td><td>2026-10-09</td><td>接続エラー</td><td>更新</td><td>編集</td><td>削除</td>
      </tr>
      <tr>
        <td><a href="/accounts/show/IDupupupupupupupupup3">更新中口座</a></td>
        <td>10,000円</td><td>2026-10-09</td><td>更新中</td><td>更新</td><td>編集</td><td>削除</td>
      </tr>
      <tr>
        <td><a href="/accounts/show/IDsusussusususususus4">停止口座</a></td>
        <td>1,000円</td><td>2026-10-01</td><td>連携停止中</td><td>更新</td><td>編集</td><td>削除</td>
      </tr>
    </tbody></table></body></html>`;
    const accounts = parseAccounts(statusHtml);
    expect(accounts[0].status.status).toBe("ok");
    expect(accounts[1].status.status).toBe("error");
    expect(accounts[1].status.statusText).toBe("接続エラー");
    expect(accounts[2].status.status).toBe("updating");
    expect(accounts[3].status.status).toBe("suspended");
  });

  it("更新状態列が読めない行は status を付けない（=ok 扱い）", () => {
    const minimalHtml = `
    <html><body><table><tbody>
      <tr>
        <td><a href="/accounts/show/IDminminminminminmin1">最低限口座</a></td>
        <td>500,000円</td>
      </tr>
    </tbody></table></body></html>`;
    const accounts = parseAccounts(minimalHtml);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].status.status).toBeUndefined();
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

  it("集約テーブル（種類・名称）と内訳テーブル（名称）が併存しても、後発テーブルの同一金額行を二重計上しない", () => {
    // 実測 ssnb 銀行/電子マネーページ: 集約行（種類・名称）と支店/カード行（名称）が
    // 別テーブルで併存する。old parser は先頭の種類・名称テーブルのみ採用していた
    const html = `
    <table>
      <thead><tr><th>種類・名称</th><th>残高</th></tr></thead>
      <tbody>
        <tr><td>アメシスト支店 普通預金</td><td>35円</td></tr>
        <tr><td>SBIハイパー預金</td><td>37,818円</td></tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>名称</th><th>残高</th></tr></thead>
      <tbody>
        <tr><td>アメシスト支店</td><td>35円</td></tr>
        <tr><td>さくら支店(300)</td><td>37,818円</td></tr>
      </tbody>
    </table>`;
    expect(parseHoldings(html, "acc-1").map((h) => h.name)).toEqual([
      "アメシスト支店 普通預金",
      "SBIハイパー預金",
    ]);
  });

  it("集約テーブル（種類・名称）と内訳テーブル（名称）が併存しても、後発の「名称」行を二重計上しない", () => {
    const html = `
    <table><tr><th>種類・名称</th><th>残高</th></tr><tr><td>SBIハイパー預金</td><td>37,818円</td></tr></table>
    <table><tr><th>名称</th><th>残高</th></tr><tr><td>さくら支店(300)</td><td>37,818円</td></tr></table>`;
    expect(parseHoldings(html, "acc-1").map((h) => h.name)).toEqual(["SBIハイパー預金"]);
  });

  it("同一テーブル内の同額行は正当な別銘柄として保持する（テーブル跨ぎのみ重複排除）", () => {
    const html = `
    <table><tr><th>種類・名称</th><th>残高</th></tr>
      <tr><td>普通預金 A</td><td>1,000円</td></tr>
      <tr><td>普通預金 B</td><td>1,000円</td></tr>
    </table>`;
    expect(parseHoldings(html, "acc-1").map((h) => h.name)).toEqual(["普通預金 A", "普通預金 B"]);
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

  it("実測（ssnb /accounts/show NRK・SBIベネフィット）の「現在価値/取得価額/評価損益」ヘッダを parse する", () => {
    const html = `
    <table>
      <thead><tr><th>名称</th><th>取得価額</th><th>現在価値</th><th>評価損益</th><th>評価損益率</th><th>取得日</th></tr></thead>
      <tbody>
        <tr><td>三菱UFJ DC海外株式インデックスファンド</td><td>150,812円</td><td>328,143円</td><td>177,331円</td><td>117.58%</td><td></td></tr>
      </tbody>
    </table>`;
    const holdings = parseHoldings(html, "nrk-1");
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      name: "三菱UFJ DC海外株式インデックスファンド",
      value: 328143,
      averagePrice: 150812,
      unrealizedGain: 177331,
    });
  });

  it("実測（楽天証券・Zaif）の「名称/種類/番号/残高」テーブルで残高が '-' の行は skip する", () => {
    const html = `
    <table>
      <thead><tr><th>名称</th><th>種類</th><th>番号</th><th>残高</th></tr></thead>
      <tbody>
        <tr><td></td><td>金・プラチナ</td><td></td><td>-</td></tr>
        <tr><td></td><td>証券口座</td><td></td><td>-</td></tr>
      </tbody>
    </table>`;
    expect(parseHoldings(html, "rkt-1")).toEqual([]);
  });
});

describe("parseHoldings の assetCategory 推定（本家資産カテゴリ語彙）", () => {
  it("銘柄名・口座カテゴリから assetCategory を付ける", () => {
    const html = `
    <table>
      <thead><tr><th>名称</th><th>残高</th></tr></thead>
      <tbody>
        <tr><td>普通預金</td><td>35円</td></tr>
        <tr><td>eMAXIS Slim 米国株式(S&P500)</td><td>110,000円</td></tr>
      </tbody>
    </table>`;
    // SBIベネフィット（投信のみ）を想定: 口座カテゴリ other
    const holdings = parseHoldings(html, "bf-1", { category: "other", accountName: "SBIベネフィット" });
    expect(holdings[0]).toMatchObject({ name: "普通預金", assetCategory: "預金・現金" });
    expect(holdings[1]).toMatchObject({ name: "eMAXIS Slim 米国株式(S&P500)", assetCategory: "投資信託" });
  });

  it("口座カテゴリ crypto / pension を資産カテゴリに写像する", () => {
    const html = `<table><thead><tr><th>名称</th><th>残高</th></tr></thead><tbody><tr><td>円残高</td><td>101円</td></tr></tbody></table>`;
    expect(parseHoldings(html, "cc-1", { category: "crypto", accountName: "Coincheck" })[0].assetCategory).toBe("暗号資産");
    expect(parseHoldings(html, "nrk-1", { category: "pension", accountName: "NRK(確定拠出年金)" })[0].assetCategory).toBe("年金");
  });

  it("Suica / 楽天キャッシュを口座名から電子マネー・ポイントに分類する", () => {
    const html = `<table><thead><tr><th>名称</th><th>残高</th></tr></thead><tbody><tr><td>メイン</td><td>1305円</td></tr></tbody></table>`;
    expect(parseHoldings(html, "sc-1", { category: "other", accountName: "モバイルSuica" })[0].assetCategory).toBe("電子マネー・プリペイド");
    expect(parseHoldings(html, "rk-1", { category: "other", accountName: "楽天市場" })[0].assetCategory).toBe("その他");
  });

  it("証券口座の非現金・非ファンド銘柄は株式(現物)", () => {
    const html = `
    <table>
      <thead><tr><th>コード</th><th>銘柄</th><th>数量</th><th>残高</th></tr></thead>
      <tbody><tr><td>7203</td><td>トヨタ自動車</td><td>100株</td><td>281,400円</td></tr></tbody>
    </table>`;
    const holdings = parseHoldings(html, "sb-1", { category: "securities", accountName: "SBI証券" });
    expect(holdings[0].assetCategory).toBe("株式(現物)");
  });

  it("opts 未指定でもパースは壊れない（デフォルト other）", () => {
    const html = `<table><thead><tr><th>名称</th><th>残高</th></tr></thead><tbody><tr><td>円残高</td><td>101円</td></tr></tbody></table>`;
    expect(parseHoldings(html, "x-1")[0].assetCategory).toBe("その他");
  });
});

describe("parseHoldings（実測 SBI証券/新生/NRK のテーブル構造）", () => {
  it("口座概要テーブル（名称|種類|番号|残高）は除外し、株式33行+投信12行+現金を合算する（実測 SBI証券）", () => {
    const stockRows = Array.from({ length: 33 }, (_, i) => {
      const v = (i + 1) * 1000;
      return `<tr><td>${1000 + i}</td><td>銘柄${i + 1}</td><td>100</td><td>1,717</td><td>2,000</td><td>${v.toLocaleString()}円</td><td>0円</td><td>100円</td><td>5.0%</td><td></td></tr>`;
    }).join("");
    const fundRows = Array.from({ length: 12 }, (_, i) => {
      const v = (i + 1) * 2000;
      return `<tr><td>ファンド${i + 1}</td><td>50,000</td><td>27,021</td><td>38,635</td><td>${v.toLocaleString()}円</td><td>0円</td><td>100円</td><td>5.0%</td><td></td></tr>`;
    }).join("");
    const html = `
    <table><thead><tr><th>名称</th><th>種類</th><th>番号</th><th>残高</th></tr></thead><tbody>
      <tr><td>さくら支店(300)</td><td>証券口座</td><td>4691735</td><td>10,381,046円</td></tr>
    </tbody></table>
    <table><thead><tr><th>種類・名称</th><th>残高</th></tr></thead><tbody>
      <tr><td>米ドル 現金</td><td>35,713円</td></tr>
      <tr><td>香港ドル 現金</td><td>16円</td></tr>
      <tr><td>現金残高(ハイブリッド預金除く)</td><td>26円</td></tr>
      <tr><td>現金（AI投資）</td><td>2,446円</td></tr>
    </tbody></table>
    <table><thead><tr><th>銘柄コード</th><th>銘柄名</th><th>保有数</th><th>平均取得単価</th><th>現在値</th><th>評価額</th><th>前日比</th><th>評価損益</th><th>評価損益率</th><th>取得日</th></tr></thead><tbody>${stockRows}</tbody></table>
    <table><thead><tr><th>銘柄名</th><th>保有数</th><th>平均取得単価</th><th>基準価額</th><th>評価額</th><th>前日比</th><th>評価損益</th><th>評価損益率</th><th>取得日</th></tr></thead><tbody>${fundRows}</tbody></table>`;
    const holdings = parseHoldings(html, "sbi-1", { category: "securities", accountName: "SBI証券" });
    // 口座概要の 10,381,046 が混入しないこと
    expect(holdings.some((h) => h.value === 10381046)).toBe(false);
    expect(holdings).toHaveLength(4 + 33 + 12);
    const stock = holdings.find((h) => h.name === "銘柄1")!;
    // 平均取得単価は円表記なしのセルを loose parse する
    expect(stock).toMatchObject({ quantity: 100, averagePrice: 1717, value: 1000 });
    const cash = 35713 + 16 + 26 + 2446;
    const stocks = Array.from({ length: 33 }, (_, i) => (i + 1) * 1000).reduce((a, b) => a + b, 0);
    const funds = Array.from({ length: 12 }, (_, i) => (i + 1) * 2000).reduce((a, b) => a + b, 0);
    const sum = holdings.reduce((s, h) => s + h.value, 0);
    expect(sum).toBe(cash + stocks + funds);
  });

  it("口座概要テーブルの支店名で商品名を取り違えない（実測 SBI新生: 132,861 が復活）", () => {
    const html = `
    <table><thead><tr><th>名称</th><th>種類</th><th>番号</th><th>残高</th></tr></thead><tbody>
      <tr><td>さくら支店(300)</td><td>円普通預金</td><td>4691735</td><td>132,861円</td></tr>
      <tr><td>さくら支店(300)</td><td>SBIハイパー預金</td><td>4691735</td><td>37,818円</td></tr>
    </tbody></table>
    <table><thead><tr><th>種類・名称</th><th>残高</th></tr></thead><tbody>
      <tr><td>円普通預金</td><td>132,861円</td></tr>
      <tr><td>SBIハイパー預金</td><td>37,818円</td></tr>
    </tbody></table>`;
    const holdings = parseHoldings(html, "shinsei-1", { category: "bank", accountName: "SBI新生銀行" });
    expect(holdings.map((h) => h.name)).toEqual(["円普通預金", "SBIハイパー預金"]);
    expect(holdings.reduce((s, h) => s + h.value, 0)).toBe(170679);
  });

  it("同テーブル内で他行合計と一致する集約行を除外する（実測 NRK: 石川サンケン株式会社 1,004,921）", () => {
    const html = `
    <table><thead><tr><th>名称</th><th>取得価額</th><th>現在価値</th><th>評価損益</th><th>評価損益率</th><th>取得日</th></tr></thead><tbody>
      <tr><td>三菱UFJ DC海外株式インデックスファンド</td><td>150,812円</td><td>328,143円</td><td>177,331円</td><td>117.58%</td><td></td></tr>
      <tr><td>ラッセル・DC外株ファンド</td><td>160,000円</td><td>321,022円</td><td>161,022円</td><td>100.64%</td><td></td></tr>
      <tr><td>三菱UFJ 純金ファンド(愛称:ファインゴールド)</td><td>180,000円</td><td>355,756円</td><td>175,756円</td><td>97.64%</td><td></td></tr>
      <tr><td>石川サンケン株式会社</td><td>490,812円</td><td>1,004,921円</td><td>514,109円</td><td>104.75%</td><td></td></tr>
    </tbody></table>`;
    const holdings = parseHoldings(html, "nrk-1", { category: "pension", accountName: "NRK(確定拠出年金)" });
    expect(holdings.map((h) => h.name)).toEqual([
      "三菱UFJ DC海外株式インデックスファンド",
      "ラッセル・DC外株ファンド",
      "三菱UFJ 純金ファンド(愛称:ファインゴールド)",
    ]);
    expect(holdings.reduce((s, h) => s + h.value, 0)).toBe(1004921);
  });

  it("NRK 実データ形状（集約行は value のみで取得価額/評価損益が null）でも明細3行の合計行を除外する", () => {
    const html = `
    <table><thead><tr><th>名称</th><th>取得価額</th><th>現在価値</th><th>評価損益</th><th>評価損益率</th><th>取得日</th></tr></thead><tbody>
      <tr><td>三菱UFJ DC海外株式インデックスファンド</td><td>150,812円</td><td>328,143円</td><td>177,331円</td><td>117.58%</td><td></td></tr>
      <tr><td>ラッセル・DC外株ファンド</td><td>161,012円</td><td>321,022円</td><td>160,010円</td><td>100.64%</td><td></td></tr>
      <tr><td>三菱UFJ 純金ファンド(愛称:ファインゴールド)</td><td>160,951円</td><td>355,756円</td><td>194,805円</td><td>97.64%</td><td></td></tr>
      <tr><td>石川サンケン株式会社</td><td></td><td>1,004,921円</td><td></td><td></td><td></td></tr>
    </tbody></table>`;
    const holdings = parseHoldings(html, "nrk-1", { category: "pension", accountName: "NRK(確定拠出年金)" });
    expect(holdings.map((h) => h.name)).toEqual([
      "三菱UFJ DC海外株式インデックスファンド",
      "ラッセル・DC外株ファンド",
      "三菱UFJ 純金ファンド(愛称:ファインゴールド)",
    ]);
  });

  it("評価額だけが他行合計に一致する正当な3行（取得価額が非整合）は除外しない", () => {
    const html = `
    <table><thead><tr><th>名称</th><th>取得価額</th><th>現在価値</th></tr></thead><tbody>
      <tr><td>銘柄A</td><td>500,000円</td><td>600,000円</td></tr>
      <tr><td>銘柄B</td><td>300,000円</td><td>400,000円</td></tr>
      <tr><td>銘柄C</td><td>999,999円</td><td>1,000,000円</td></tr>
    </tbody></table>`;
    const holdings = parseHoldings(html, "acc-1", { category: "securities" });
    expect(holdings.map((h) => h.name)).toEqual(["銘柄A", "銘柄B", "銘柄C"]);
    expect(holdings.reduce((s, h) => s + h.value, 0)).toBe(2000000);
  });

  it("値1列しか無く他行が2行以下のテーブルでは集約行を除外しない", () => {
    const html = `
    <table><thead><tr><th>種類・名称</th><th>残高</th></tr></thead><tbody>
      <tr><td>口座A</td><td>100,000円</td></tr>
      <tr><td>口座B</td><td>200,000円</td></tr>
      <tr><td>口座C</td><td>300,000円</td></tr>
    </tbody></table>`;
    const holdings = parseHoldings(html, "acc-1", { category: "bank" });
    expect(holdings.map((h) => h.name)).toEqual(["口座A", "口座B", "口座C"]);
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
        externalId: expect.any(String),
        accountId: "acc-1",
        date: "2026-10-02",
        description: "スーパー",
        amount: -22000,
        category: "食費 / 食料品",
        subCategory: "食料品",
      },
      {
        externalId: expect.any(String),
        accountId: "acc-1",
        date: "2026-10-05",
        description: "給与",
        amount: 300000,
        category: "収入 / 給与",
        subCategory: "給与",
      },
      {
        externalId: expect.any(String),
        accountId: "acc-1",
        date: "2026-10-06",
        description: "口座間振替",
        amount: -50000,
        category: null,
        subCategory: null,
      },
    ]);
  });

  it("内容（日付/摘要/金額）から決定的な externalId を合成する（再スクレイプで同一・全件一意）", () => {
    const txs = parseTransactions(html, "acc-1", new Date(2026, 9, 9));
    const ids = txs.map((t) => t.externalId);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const again = parseTransactions(html, "acc-1", new Date(2026, 9, 9));
    expect(again.map((t) => t.externalId)).toEqual(ids);
  });

  it("同日・同額・同摘要が正当に複数ある行は出現回数で区別し、消さない", () => {
    const dupHtml = `
    <table class="table table-hover">
      <thead><tr><th>日付</th><th>内容</th><th>金額（円）</th></tr></thead>
      <tbody>
        <tr><td>10/01(水)</td><td>コーヒー</td><td>-450</td></tr>
        <tr><td>10/01(水)</td><td>コーヒー</td><td>-450</td></tr>
      </tbody>
    </table>`;
    const txs = parseTransactions(dupHtml, "acc-1", new Date(2026, 9, 9));
    expect(txs).toHaveLength(2);
    expect(txs[0]!.externalId).not.toBe(txs[1]!.externalId);
  });

  it("table-hover のテーブルが無ければ例外", () => {
    expect(() => parseTransactions("<table><tr><th>日付</th></tr></table>", "acc-1")).toThrow(ScrapeParseError);
  });
});

describe("parseHoldings の同名別ポジション一意化（SBI証券の株式表/投信表 別建て）", () => {
  const stockTable = (rows: string) => `
    <table><thead><tr><th>銘柄コード</th><th>銘柄名</th><th>保有数</th><th>平均取得単価</th><th>現在値</th><th>評価額</th><th>前日比</th><th>評価損益</th><th>評価損益率</th><th>取得日</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  const fundTable = (rows: string) => `
    <table><thead><tr><th>銘柄名</th><th>保有数</th><th>平均取得単価</th><th>基準価額</th><th>評価額</th><th>前日比</th><th>評価損益</th><th>評価損益率</th><th>取得日</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  // 実測 3 組（投信値, 株式値）
  const rakutenFund = `<tr><td>楽天グループ</td><td>100</td><td>1,000</td><td>1,100</td><td>191,880円</td><td>0円</td><td>1,000円</td><td>1.0%</td><td></td></tr>`;
  const rakutenStock = `<tr><td>127920</td><td>楽天グループ</td><td>7,800</td><td>500</td><td>600</td><td>127,920円</td><td>0円</td><td>100円</td><td>1.0%</td><td></td></tr>`;
  const nfFund = `<tr><td>NF日経高配当50</td><td>20</td><td>2,000</td><td>2,100</td><td>104,190円</td><td>0円</td><td>1,000円</td><td>1.0%</td><td></td></tr>`;
  const nfStock = `<tr><td>590410</td><td>NF日経高配当50</td><td>2,900</td><td>300</td><td>400</td><td>590,410円</td><td>0円</td><td>100円</td><td>1.0%</td><td></td></tr>`;
  const vgFund = `<tr><td>バンガード 米国高配当株式ETF</td><td>30</td><td>3,000</td><td>3,100</td><td>3,741,956円</td><td>0円</td><td>1,000円</td><td>1.0%</td><td></td></tr>`;
  const vgStock = `<tr><td>2993565</td><td>バンガード 米国高配当株式ETF</td><td>9,000</td><td>300</td><td>400</td><td>2,993,565円</td><td>0円</td><td>100円</td><td>1.0%</td><td></td></tr>`;
  const collisionHtml = stockTable(rakutenStock + nfStock + vgStock) + fundTable(rakutenFund + nfFund + vgFund);

  it("① 衝突あり: 3 組 6 行が別名で生存し合計が保存される", () => {
    const holdings = parseHoldings(collisionHtml, "sbi-1", { category: "securities", accountName: "SBI証券" });
    expect(holdings.map((h) => h.name)).toEqual([
      "楽天グループ（株式）",
      "NF日経高配当50（株式）",
      "バンガード 米国高配当株式ETF（株式）",
      "楽天グループ（投信）",
      "NF日経高配当50（投信）",
      "バンガード 米国高配当株式ETF（投信）",
    ]);
    expect(holdings.reduce((s, h) => s + h.value, 0)).toBe(
      191880 + 127920 + 104190 + 590410 + 3741956 + 2993565,
    );
  });

  it("② 非衝突の口座は名前を 1 バイトも変えない", () => {
    const html = stockTable(
      `<tr><td>1001</td><td>銘柄A</td><td>100</td><td>1,000</td><td>1,100</td><td>110,000円</td><td>0円</td><td>0円</td><td>0%</td><td></td></tr>`,
    ) + fundTable(`<tr><td>ファンドB</td><td>10</td><td>1,000</td><td>1,100</td><td>11,000円</td><td>0円</td><td>0円</td><td>0%</td><td></td></tr>`);
    expect(parseHoldings(html, "sbi-1", { category: "securities" }).map((h) => h.name)).toEqual([
      "銘柄A",
      "ファンドB",
    ]);
  });

  it("③ 同一テーブル内の同名 2 行はマージせず両方残る", () => {
    const html = stockTable(
      rakutenStock +
        `<tr><td>127921</td><td>楽天グループ</td><td>200</td><td>510</td><td>610</td><td>130,000円</td><td>0円</td><td>100円</td><td>1.0%</td><td></td></tr>`,
    );
    const holdings = parseHoldings(html, "sbi-1", { category: "securities" });
    expect(holdings).toHaveLength(2);
    expect(new Set(holdings.map((h) => h.name)).size).toBe(2);
    expect(holdings.every((h) => h.name.startsWith("楽天グループ"))).toBe(true);
    for (const h of holdings) expect(h.quantity).toBeGreaterThan(0);
  });

  it("⑤ 同一 HTML を 2 回 parse しても名前集合が完全一致する（決定性）", () => {
    const a = parseHoldings(collisionHtml, "sbi-1", { category: "securities" }).map((h) => h.name);
    const b = parseHoldings(collisionHtml, "sbi-1", { category: "securities" }).map((h) => h.name);
    expect(b).toEqual(a);
  });

  it("④ 未知シグネチャ（基準価額も銘柄コードも無い）は序数フォールバックで一意化する", () => {
    const html = `
    <table><thead><tr><th>名称</th><th>残高</th></tr></thead><tbody>
      <tr><td>債券X</td><td>1,000円</td></tr>
      <tr><td>債券X</td><td>2,000円</td></tr>
    </tbody></table>`;
    const names = parseHoldings(html, "acc-1", { category: "other" }).map((h) => h.name);
    expect(names).toEqual(["債券X（T1）", "債券X（T2）"]);
  });

  it("④b 生成名が既存名と衝突する場合はループでさらに接尾辞を足す", () => {
    const html = stockTable(rakutenStock) + fundTable(
      rakutenFund +
        `<tr><td>楽天グループ（投信）</td><td>50</td><td>1,000</td><td>1,100</td><td>55,000円</td><td>0円</td><td>0円</td><td>0%</td><td></td></tr>`,
    );
    const names = parseHoldings(html, "sbi-1", { category: "securities" }).map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
    // 実在名「楽天グループ（投信）」はそのまま、衝突した投信行だけ別名になる
    expect(names).toContain("楽天グループ（投信）");
    expect(names).toContain("楽天グループ（株式）");
    expect(names).toHaveLength(3);
  });

  it("④c 接尾辞の付与は estimateAssetCategory の後（接尾辞が資産分類に影響しない）", () => {
    const holdings = parseHoldings(collisionHtml, "sbi-1", { category: "securities", accountName: "SBI証券" });
    const fund = holdings.find((h) => h.name === "楽天グループ（投信）")!;
    const stock = holdings.find((h) => h.name === "楽天グループ（株式）")!;
    // category=securities かつ銘柄名に投信語が無いので、接尾辞が無ければ分類は 株式(現物) のまま。
    // 接尾辞を分類前に付けると「楽天グループ（投信）」が投資信託へ誤分類される。
    expect(fund.assetCategory).toBe("株式(現物)");
    expect(stock.assetCategory).toBe("株式(現物)");
  });
});

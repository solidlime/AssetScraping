/**
 * ssnb SSR HTML のパーサ群（2026-10 実測の HTML 構造に準拠）。
 *
 * 解析対象はテーブル実測構造:
 * - /accounts            口座一覧テーブル（各行 td[0]=口座リンク, td[1]=残高）
 * - /accounts/show/{id}  「種類・名称」ヘッダの残高内訳テーブル
 * - /bs/history          資産推移テーブル（th=日付, td=金額, ヘッダ th=カテゴリ）
 * - /cf                  table-hover の取引明細テーブル
 * 解釈できない場合は例外（空データを黙って書かない）。ただし残高内訳テーブルが
 * 存在しない口座は正常な空配列を返す。
 */
import type {
  Account,
  AccountCategory,
  AccountStatus,
  AssetHistoryPoint,
  Holding,
  Transaction,
} from "@asset-scraping/shared";
import { ACCOUNT_CATEGORIES, buildTransactionExternalId } from "@asset-scraping/shared";
import { categorizeTransaction } from "./categorize.js";
import { parse, NodeType, type Node, type HTMLElement as HtmlElement } from "node-html-parser";

export class ScrapeParseError extends Error {
  constructor(what: string) {
    super(`スクレイプ結果のパースに失敗しました: ${what}（ssnb の HTML 構造が想定と異なる可能性があります）`);
    this.name = "ScrapeParseError";
  }
}

const CATEGORY_KEYWORDS: Array<[AccountCategory, string[]]> = [
  ["bank", ["銀行", "預金", "普通", "定期"]],
  ["securities", ["証券", "投信", "投資信託", "株", "ETF"]],
  ["cash", ["現金", "wallet"]],
  ["point", ["ポイント"]],
  ["crypto", ["暗号資産", "仮想通貨", "bitcoin"]],
  ["pension", ["年金", "iDeCo", "ideco"]],
  ["real_estate", ["不動産"]],
];

export function guessCategory(text: string): AccountCategory {
  for (const [cat, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) return cat;
  }
  return "other";
}

/** "1,234,567円" / "-12,345円" → number。円表記が必須（日付・カレンダー数字の誤爆防止）。 */
export function parseYen(text: string): number | null {
  const m = /(-?\d[\d,]*(?:\.\d+)?)円/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1]?.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 円表記なしの数値（取引明細金額 "-22,000\n(振替)" 等）。最初の数値トークンを返す。
 * 日付・カテゴリ等の非金額セルは呼び出し側で選んで渡すこと。
 */
export function parseYenLoose(text: string): number | null {
  const m = /(-?\d[\d,]*(?:\.\d+)?)/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1]?.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseDate(text: string, now: Date = new Date()): string | null {
  const iso = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(text);
  if (iso) {
    const [, y, mo, d] = iso;
    return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  // 実測: 取引明細の日付は "10/02(金)"（年なし、当月=当年）
  const md = /(\d{1,2})\/(\d{1,2})/.exec(text);
  if (md) {
    const mo = Number(md[1]);
    const d = Number(md[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${now.getFullYear()}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 口座一覧・残高
// ---------------------------------------------------------------------------

/**
 * 要素が非表示かどうか（display:none / visibility:hidden / hidden 属性）。
 * ssnb /accounts の td[3] は display:none の placeholder「更新中」と可視の「正常」を
 * 同居させるため、隠し要素を除外しないと textContent に「更新中」が混入する。
 */
function isHiddenElement(el: HtmlElement): boolean {
  if (el.hasAttribute("hidden")) return true;
  const style = el.getAttribute("style") ?? "";
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

/**
 * 可視テキストのみを連結する（隠し要素とその子孫を除外）。
 * node-html-parser の `.text` / `.textContent` / `.innerText` / `.rawText` はいずれも
 * display:none を除外しない（実測 9.0.4: すべて "更新中 正常" を返す）。自前で除外する。
 */
function visibleText(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return node.text; // decode 済み
  if (node.nodeType !== NodeType.ELEMENT_NODE) return ""; // コメント等は無視
  const el = node as HtmlElement;
  if (isHiddenElement(el)) return "";
  return el.childNodes.map((child) => visibleText(child)).join("");
}

/** セルテキストの正規化（可視テキストのみ、改行・複数空白 → 単一空白、前後空白トリム） */
function cellText(cell: HtmlElement | null | undefined): string {
  if (!cell) return "";
  return cell.childNodes
    .map((child) => visibleText(child))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * /accounts の「更新状態」列テキスト → 本家語彙。
 * 実測 2026-10 の正常系は「取得済み」。エラー系は未実測のため本家 mfIdAccountStatus の
 * 表示語彙（接続エラー/更新中/連携停止中）で前方一致判定し、未知の語は undefined（=ok 扱い）にする。
 */
export function parseAccountStatusKind(text: string): "ok" | "error" | "updating" | "suspended" | undefined {
  // 確定語（正常/取得済み）を「更新中」より先に評価する。ssnb td[3] の隠し placeholder
  // 「更新中」と可視ステータスが連結して届いても updating に化けないための二重防御。
  if (!text || text.includes("取得済み") || text.includes("正常")) return "ok";
  if (text.includes("エラー")) return "error";
  if (text.includes("更新中")) return "updating";
  if (text.includes("停止")) return "suspended";
  return undefined;
}

/**
 * 口座一覧（/accounts の構造化テーブル）を parse する。実測（2026-10）:
 * - 各行 td[0] に a[href="/accounts/show/{id}"]（金融機関名テキスト）、td[1] に残高（"35円" 形式）
 * - td[3] に更新状態（「取得済み」等）。判定結果は status に入れる
 */
export function parseAccounts(html: string): Array<Account & { status: AccountStatus }> {
  const root = parse(html);
  const results: Array<Account & { status: AccountStatus }> = [];
  const scrapedAt = new Date().toISOString();
  const seen = new Set<string>();

  for (const link of root.querySelectorAll('a[href*="/accounts/show/"]')) {
    const href = link.getAttribute("href") ?? "";
    const id = /\/accounts\/show\/([^/?#]+)/.exec(href)?.[1];
    if (!id || seen.has(id)) continue;

    const row = link.closest("tr");
    const tds = row ? row.querySelectorAll("td") : [];
    if (tds.length < 2) continue;
    const name = cellText(tds[0]);
    const balance = parseYen(cellText(tds[1]));
    if (!name || balance === null) continue;

    seen.add(id);
    const statusKind = tds.length > 3 ? parseAccountStatusKind(cellText(tds[3])) : undefined;
    results.push({
      id,
      name,
      institution: cellText(link) || name,
      category: guessCategory(name),
      status: {
        accountId: id,
        balance,
        scrapedAt,
        ...(statusKind !== undefined
          ? { status: statusKind, statusText: cellText(tds[3]) }
          : {}),
      },
    });
  }

  if (results.length === 0) {
    throw new ScrapeParseError("口座一覧テーブル（/accounts/show/ リンク付き行）が 1 件も見つかりません");
  }
  return results;
}

// ---------------------------------------------------------------------------
// 保有資産
// ---------------------------------------------------------------------------

/** 保有資産テーブルの列レイアウト（実測 2026-10 の 3 形態） */
interface HoldingsColumns {
  nameIdx: number;
  valueIdx: number;
  quantityIdx: number | null;
  averagePriceIdx: number | null;
  unrealizedGainIdx: number | null;
}

const NONE: HoldingsColumns = {
  nameIdx: -1,
  valueIdx: -1,
  quantityIdx: null,
  averagePriceIdx: null,
  unrealizedGainIdx: null,
};

/**
 * ヘッダ th から列位置を決める。本家 portfolio.ts の resolveDepositColumns と同様、
 * ラベル表記ゆれは列名表引きで吸収する。
 * - depo 形: 種類・名称 | 残高
 * - 名称形: 名称 | 残高
 * - pns 形: 種類・名称 | 平均取得価格 | 評価額 | 取得価額 | 評価損益 | 評価損益率
 * - eq 形: コード | 銘柄 | 数量 | 平均取得価格 | 単価 | 残高 | …（name ラベルは「銘柄」）
 * - 株式形: 銘柄コード | 銘柄名 | 保有数 | 平均取得単価 | 現在値 | 評価額 | …（実測 SBI証券）
 * - 投信形: 銘柄名 | 保有数 | 平均取得単価 | 基準価額 | 評価額 | …（実測 SBI証券）
 */
export function resolveHoldingsColumns(headers: string[]): HoldingsColumns {
  // 口座概要テーブル（名称|種類|番号|残高 等）は保有資産ではない。番号列の有無で除外する。
  // 実測 SBI新生銀行: 口座概要の名称列は「さくら支店(300)」で、商品名は「種類」側にあり、
  // これを holdings として拾うと (account_id,name) 衝突で残高を取り違える（132,861 が消える）。
  if (headers.includes("番号")) return NONE;
  const indexOf = (labels: string[]): number =>
    headers.findIndex((h) => labels.includes(h));
  // 名称系: 種類・名称（銀行/現金）、銘柄名（株式・投信, 実測 SBI証券）、名称（年金/保険）、銘柄（旧 eq 形）
  const name = indexOf(["種類・名称", "銘柄名", "名称", "銘柄"]);
  if (name < 0) return NONE;
  // 金額列: 残高があれば優先、無ければ 評価額 / 現在価値（pns 形実測 2026-10）
  const valueLabels = ["残高", "評価額", "現在価値"];
  let value = -1;
  for (const label of valueLabels) {
    const i = headers.indexOf(label);
    if (i >= 0 && (value < 0 || i < value)) value = i;
  }
  if (value < 0) return NONE;
  // 保有数（実測 SBI証券 株式・投信）/ 数量（旧 eq 形）
  const quantity = indexOf(["保有数", "数量"]);
  // 平均取得単価（実測 SBI証券。円表記なし）/ 平均取得価格 / 取得価額（pns 形）
  const avgCost = indexOf(["平均取得単価", "平均取得価格", "取得価額"]);
  // 評価損益: pns/eq 形・株式形で「含み損益」または「評価損益」の列
  const gain = indexOf(["含み損益", "評価損益"]);
  return {
    nameIdx: name,
    valueIdx: value,
    quantityIdx: quantity >= 0 ? quantity : null,
    averagePriceIdx: avgCost >= 0 ? avgCost : null,
    unrealizedGainIdx: gain >= 0 ? gain : null,
  };
}

/**
 * 同一テーブル内で「他の行すべての合計」に一致する行の index を返す（無ければ -1）。
 * 実測 NRK(確定拠出年金): 「石川サンケン株式会社 1,004,921」は合計セルを持たない
 * 集約行で、明細 3 行（328,143 + 321,022 + 355,756）と同額。名前 regex に頼らず
 * 構造で除外する。明細が 2 行以上ある場合のみ適用する（1 行の自己一致は除外しない）。
 *
 * 誤除外ガード: 評価額 1 列だけでは正当な 3 行（600,000 / 400,000 / 1,000,000）で
 * 3 行目が偶然「他行合計」に一致し、恒久欠落し得る。よって、
 *  (a) 他行が 3 行以上ある（NRK 実データ形状: 集約行は value のみで cost/gain が null）、
 *      または
 *  (b) 全行で非 null の数値列が 2 列以上そろい、そのすべてで合計一致する、
 * のいずれかを満たすときのみ集約行と判定する。どちらも満たさない場合は -1（除外しない）
 * ＝誤削除より重複残りを選ぶ安全側。丸め由来の差は ±1 円を許容する。
 */
function findAggregateRowIndex(
  rows: Array<{ value: number; cost: number | null; gain: number | null }>,
): number {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  // 全行で数値が取れている列（value は常に非 null）
  const allCols = ["value", "cost", "gain"] as const;
  const usable = allCols.filter((c) => rows.every((r) => r[c] !== null));
  for (let i = 0; i < rows.length; i++) {
    const others = rows.filter((_, j) => j !== i);
    if (others.length < 2) continue;
    if (rows[i]!.value === 0) continue;
    // 評価額（value）の合計一致は必須
    const valueSum = others.reduce((s, r) => s + r.value, 0);
    if (!near(rows[i]!.value, valueSum)) continue;
    // (a) 明細 3 行以上（NRK 実データ形状）
    if (others.length >= 3) return i;
    // (b) 全行非 null の数値列が 2 列以上そろい、そのすべてで合計一致
    if (usable.length >= 2) {
      const allMatch = usable.every((c) => {
        const sum = others.reduce((s, r) => s + (r[c] as number), 0);
        return near(rows[i]![c] as number, sum);
      });
      if (allMatch) return i;
    }
  }
  return -1;
}

/** 数量セル（"100株" / "52.3491口" / "0.0321"）→ number。解釈不可は null */
function parseQuantity(text: string): number | null {
  const m = /(-?[\d,]+(?:\.\d+)?)/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1]?.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 口座別残高内訳（/accounts/show/{id}）の保有資産テーブル群を parse する。
 * 実測（2026-10）の 3 形態に対応:
 * - depo 形（種類・名称/残高）: 銀行・カード等。数量・単価は取れない
 * - pns 形（種類・名称/平均取得価格/評価額/…）: 年金・保険
 * - eq 形（コード/銘柄/数量/…/残高/…）: 株式
 * 1 ページに複数テーブルがある場合は合算する。対象テーブルが無い口座は空配列。
 */
/**
 * 本家資産カテゴリ語彙（meta ASSET_CATEGORIES 準拠）への推定。
 *
 * 背景: ssnb /accounts/show の内訳テーブルには本家 portfolio.item.type 相当の
 * 「資産カテゴリ」列が無いため、①口座名（電子マネー・ポイント系）→②口座カテゴリ
 * （crypto/pension/bank/cash/point・本家 normalizePortfolioCategories の
 * 暗号資産口座再分類に準拠）→③銘柄名（現金・預金系 → 投信 → 株式）の
 * 優先順で推定する。判定不能は「その他」（本家 getOrCreateCategory が
 * asset_categories を自動作成するため、語彙は本家に寄せる）。
 */
export function estimateAssetCategory(
  name: string,
  category?: AccountCategory,
  accountName?: string,
): string {
  const lname = name.toLowerCase();
  const laccount = (accountName ?? "").toLowerCase();

  // 1) 口座名・銘柄名から電子マネー・ポイント系（他の語と掛からない最先頭）
  if (/suica|pasmo|edy|nanaco|waon/.test(laccount) || /suica|pasmo|edy\b/.test(lname)) {
    return "電子マネー・プリペイド";
  }
  if (/point|ポイント|マイル/.test(laccount) || /ポイント|マイル/.test(lname)) {
    return "ポイント";
  }

  // 2) 口座カテゴリで一意に決まるもの
  if (category === "crypto") return "暗号資産";
  if (category === "pension") return "年金";
  if (category === "bank" || category === "cash") return "預金・現金";
  if (category === "point") return "ポイント";

  // 3) 銘柄名ベース（現金・預金系を投信より先に判定する）
  if (/現金|預金|普通|当座|定期|支店/.test(name)) return "預金・現金";
  if (/ファンド|投資信託|投信|emaxis|s&p500|インデックス|日経/.test(lname)) {
    return "投資信託";
  }
  if (category === "securities") return "株式(現物)";
  return "その他";
}

export function parseHoldings(
  html: string,
  accountId: string,
  opts?: { category?: AccountCategory; accountName?: string },
): Holding[] {
  const root = parse(html);
  const scrapedAt = new Date().toISOString();

  const holdings: Array<Holding & { kindTag?: string }> = [];
  // テーブル跨ぎの重複排除用。ssnb の残高内訳は集約テーブル（種類・名称）と
  // 支店/カード内訳テーブル（名称）が併存し、同一金額が別名で 2 回現れる。
  // 先行テーブルの金額を集合に入れ、後発テーブルの同一金額行は二重計上とみなし skip する。
  // （同一テーブル内の同額行は正当な別銘柄として保持するため、テーブル処理後に登録する）
  const seenValuesFromEarlierTables = new Set<number>();
  for (const table of root.querySelectorAll("table")) {
    const headers = table.querySelectorAll("th").map((th) => headerKey(cellText(th)));
    if (headers.length === 0) continue;
    const cols = resolveHoldingsColumns(headers);
    if (cols === NONE) continue;

    // 支店/カード内訳の「名称」形テーブルは、先行の集約テーブル（種類・名称）と同一金額が
    // 別名で二重計上されるため金額重複で skip する。株式・投信の「銘柄名」形は別資産で、
    // 実測 SBI証券 のように株式と投信で評価額が一致し得るため値ベースの排除をしない。
    const isDetailTable = headers[cols.nameIdx] === "名称";
    // 1 テーブル分をいったん収集し、集約行を除外してから採用する
    const candidates: Array<{
      name: string;
      quantity: number;
      value: number;
      averagePrice: number | null;
      unrealizedGain: number | null;
    }> = [];
    for (const row of table.querySelectorAll("tr")) {
      const tds = row.querySelectorAll("td");
      if (tds.length < 2) continue;
      const name = cellText(tds[cols.nameIdx]);
      if (!name || /^(合計|小計|total)/i.test(name)) continue;
      const value = parseYen(cellText(tds[cols.valueIdx]));
      if (value === null) continue;
      const quantity =
        cols.quantityIdx !== null ? (parseQuantity(cellText(tds[cols.quantityIdx])) ?? 0) : 0;
      // 実測 SBI証券: 平均取得単価セルは「1,717」のように円表記が無い → loose で拾う
      const averagePrice =
        cols.averagePriceIdx !== null
          ? parseYenLoose(cellText(tds[cols.averagePriceIdx]))
          : null;
      const unrealizedGain =
        cols.unrealizedGainIdx !== null ? parseYen(cellText(tds[cols.unrealizedGainIdx])) : null;
      candidates.push({ name, quantity, value, averagePrice, unrealizedGain });
    }

    // 構造ベースの集約行除外（他行合計と一致する行）。名前 regex では拾えないため。
    // 評価額/取得価額/評価損益を渡し、複数列一致を AND 条件に使う（誤除外防止）。
    const aggregateIdx = findAggregateRowIndex(
      candidates.map((c) => ({ value: c.value, cost: c.averagePrice, gain: c.unrealizedGain })),
    );
    if (aggregateIdx >= 0) candidates.splice(aggregateIdx, 1);

    const tableValues: number[] = [];
    const kindTag = tableKindTag(headers);
    for (const c of candidates) {
      // 0 円は重複判定に使わない（価値のない空行を消さない）
      if (isDetailTable && c.value !== 0 && seenValuesFromEarlierTables.has(c.value)) continue;
      holdings.push({
        accountId,
        name: c.name,
        assetCategory: estimateAssetCategory(c.name, opts?.category, opts?.accountName),
        quantity: c.quantity,
        value: c.value,
        averagePrice: c.averagePrice,
        unrealizedGain: c.unrealizedGain,
        scrapedAt,
        kindTag,
      });
      if (c.value !== 0) tableValues.push(c.value);
    }
    for (const value of tableValues) seenValuesFromEarlierTables.add(value);
  }
  return disambiguateHoldingNames(holdings);
}

/**
 * 保有資産テーブルの種別（名前衝突時の接尾辞）。列シグネチャ優先（実測 SBI証券: 株式表は
 * 「銘柄コード」、投信表は「基準価額」）。未知のシグネチャ（将来の債券・FX 表）は undefined を
 * 返し、呼び出し元が序数フォールバックする。名前には付けず、rename 時にだけ使う。
 */
function tableKindTag(headers: string[]): string | undefined {
  if (headers.includes("銘柄コード")) return "株式";
  if (headers.includes("基準価額")) return "投信";
  return undefined;
}

/**
 * 同名別ポジションの名前を種別接尾辞で一意化する（SBI証券は同一商品を株式表・投信表に別建てする）。
 * DB は (account_id, name) unique index の onConflictDoUpdate で同名行を統合し、実測で
 * 49 行 / 45,240,726 円 → 46 行 / 41,202,700 円 に欠損していた（差 4,038,026 円）。
 * schema・migration・unique index には触らず、パーサ側の名前規約だけで一意化する。
 *
 * 接尾辞を付けるのは 1 スクレイプ（1 口座）内に同名が 2 件以上ある行だけで、非衝突行の名前は変えない。
 * 呼び出し元が estimateAssetCategory を済ませた後に呼ぶ（「楽天グループ（投信）」等の接尾辞が
 * 資産分類ヒューリスティックに拾われないようにする）。
 */
export function disambiguateHoldingNames(holdings: Array<Holding & { kindTag?: string }>): Holding[] {
  const counts = new Map<string, number>();
  for (const h of holdings) counts.set(h.name, (counts.get(h.name) ?? 0) + 1);
  if (![...counts.values()].some((n) => n > 1)) return holdings;

  const used = new Set(holdings.map((h) => h.name));
  const seen = new Map<string, number>();
  return holdings.map((h) => {
    if ((counts.get(h.name) ?? 0) < 2) return h;
    const ordinal = (seen.get(h.name) ?? 0) + 1;
    seen.set(h.name, ordinal);
    const tag = h.kindTag ?? `T${ordinal}`;
    // 実在商品名が「〇〇（投信）」という形でも unique 違反で upsert が死なないようループで足す
    let name = `${h.name}（${tag}）`;
    for (let n = 2; used.has(name); n++) name = `${h.name}（${tag}）_${n}`;
    used.add(name);
    return { ...h, name };
  });
}

// ---------------------------------------------------------------------------
// 資産推移
// ---------------------------------------------------------------------------

/**
 * /bs/history の金額カテゴリ列（実測 2026-10）。この列のヘッダラベルをそのまま
 * category として保存する。web の資産構成は holdings の assetCategory（同じく
 * このラベル語彙）で前日比を name 照合するため、写像すると結合が崩れる。
 * 合計・詳細・日付は金額カテゴリではないので skip する。
 */
const HISTORY_CATEGORY_COLUMNS: readonly string[] = [
  "預金・現金",
  "株式(現物)",
  "投資信託",
  "債券",
  "暗号資産",
  "FX",
  "年金",
  "ポイント",
];

/** 金額カテゴリではない列（skip 対象） */
const HISTORY_SKIP_COLUMNS = new Set(["合計", "詳細", "日付"]);

/** 列ヘッダテキストを正規化（全角括弧 → 半角）して表引きキーにする */
function headerKey(text: string): string {
  return text.replace(/[（）]/g, (c) => (c === "（" ? "(" : ")")).trim();
}

/**
 * 資産推移（/bs/history の table[0]）を parse する。実測（2026-10）:
 * - ヘッダ行 th: 日付/合計/預金・現金/…/ポイント/詳細
 * - 各行: th=日付（ISO そのまま）、td=金額（"46,604,121円"、列順はヘッダに対応、最終 td=詳細リンク）
 */
export function parseAssetHistory(html: string): AssetHistoryPoint[] {
  const root = parse(html);
  const table = root
    .querySelectorAll("table")
    .find((t) =>
      t.querySelectorAll("th").some((th) => headerKey(cellText(th)) === "日付"),
    );
  if (!table) throw new ScrapeParseError("資産推移テーブル（日付ヘッダ行）が見つかりません");

  const headerRow = table
    .querySelectorAll("tr")
    .find((tr) => tr.querySelectorAll("td").length === 0);
  if (!headerRow) throw new ScrapeParseError("資産推移テーブルのヘッダ行が見つかりません");
  const headerCells = headerRow.querySelectorAll("th");
  if (headerCells.length === 0) {
    throw new ScrapeParseError("資産推移テーブルのヘッダ行が th で構成されていません");
  }
  const columns = headerCells.map((th) => {
    const key = headerKey(cellText(th));
    if (HISTORY_SKIP_COLUMNS.has(key)) return null;
    // 未知の列は取り込まない（語彙が偶然一致した列の誤取り込みを防ぐ）
    return HISTORY_CATEGORY_COLUMNS.includes(key) ? key : null;
  });

  const points: AssetHistoryPoint[] = [];
  for (const row of table.querySelectorAll("tr")) {
    const date = parseDate(cellText(row.querySelector("th")));
    if (!date) continue; // ヘッダ行・日付不明行は skip
    // 列ごとに独立したカテゴリとして保存する（ラベル語彙＝holdings の assetCategory）
    const byCategory = new Map<string, number>();
    const tds = row.querySelectorAll("td");
    for (let i = 0; i < columns.length; i++) {
      const category = columns[i];
      if (!category) continue;
      const value = parseYen(cellText(tds[i - 1]));
      if (value === null) continue; // 「詳細」リンク等の非金額セル
      byCategory.set(category, (byCategory.get(category) ?? 0) + value);
    }
    for (const [category, value] of byCategory) {
      points.push({ date, category, value });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// 取引履歴
// ---------------------------------------------------------------------------

/**
 * 取引明細（/cf の table-hover テーブル）を parse する。実測（2026-10）:
 * - th ヘッダ: 計算対象/日付/内容/金額（円）/保有金融機関/大項目/中項目/…
 * - td: [0]=checkbox、[1]=日付 "10/02(金)"、[2]=内容、[3]=金額（"-22,000\n(振替)"、負値=出金）、[5]=大項目、[6]=中項目
 * - 取引 ID リンクは無い（externalId = null）。常に当月分のみ。
 */
export function parseTransactions(html: string, accountId: string, now: Date = new Date()): Transaction[] {
  const root = parse(html);
  const table = root
    .querySelectorAll("table")
    .find((t) => {
      const ths = t.querySelectorAll("th").map((th) => cellText(th));
      return ths.includes("日付") && ths.some((s) => s.startsWith("金額"));
    });
  if (!table) throw new ScrapeParseError("取引明細テーブル（日付/金額ヘッダ行）が見つかりません");

  const headerRow = table.querySelectorAll("tr").find((tr) => tr.querySelectorAll("td").length === 0);
  if (!headerRow) throw new ScrapeParseError("取引明細テーブルのヘッダ行が見つかりません");
  const header = headerRow.querySelectorAll("th").map((th) => headerKey(cellText(th)));
  const idx = (name: string) => header.indexOf(name);
  const dateIdx = idx("日付");
  const descIdx = idx("内容");
  const amountIdx = header.findIndex((s) => s.startsWith("金額"));
  const majorIdx = idx("大項目");
  const minorIdx = idx("中項目");

  const txs: Transaction[] = [];
  // ssnb の /cf には取引 ID が無い。同日同額同摘要の正当な重複を消さないよう、
  // 内容 + 出現回数で決定的な externalId を合成し、upsert の同一性キーにする。
  const occurrenceByContent = new Map<string, number>();
  for (const row of table.querySelectorAll("tr")) {
    const tds = row.querySelectorAll("td");
    if (tds.length < 3) continue;
    const date = parseDate(cellText(tds[dateIdx]), now);
    if (!date) continue;
    const description = cellText(tds[descIdx]);
    if (!description) continue;
    // 金額セル: "-22,000\n(振替)" → -22000（(振替) 付与・負値は維持）
    const amount = parseYenLoose(cellText(tds[amountIdx]).replace(/\(振替\)/g, ""));
    if (amount === null) continue;
    const major = cellText(tds[majorIdx]);
    const minor = cellText(tds[minorIdx]);
    // 大項目・中項目が無い行は内容ベース推定（本家 seed カテゴリ体系）で補完する。
    // 判定不能は null（web 側の未分類/その他扱い）。
    const estimated = categorizeTransaction(description);
    const category = [major, minor].filter(Boolean).join(" / ") || estimated?.category || null;
    const subCategory = estimated?.subCategory ?? null;
    const contentKey = `${date}\u0000${description}\u0000${amount}`;
    const occurrence = occurrenceByContent.get(contentKey) ?? 0;
    occurrenceByContent.set(contentKey, occurrence + 1);
    txs.push({
      externalId: buildTransactionExternalId(accountId, date, description, amount, occurrence),
      accountId,
      date,
      description,
      amount,
      category,
      subCategory,
    });
  }
  return txs;
}

export { ACCOUNT_CATEGORIES };

/** ssnb.x.moneyforward.com の URL 定数 */
export const SSNB_BASE_URL = "https://ssnb.x.moneyforward.com" as const;

/** Yahoo シンボル解決結果（JPY = 東証、USD = 米国等） */
export type YahooSymbolResolution = { symbol: string; currency: "JPY" | "USD" } | null;

/**
 * 銘柄コード → Yahoo シンボル（配当シミュレータの唯一の判定箇所）。
 * - 4桁数字（`7203`）または 3桁数字+英大文字1字（`563A`/`408A`/`314A`）→ `${code}.T`（JPY）
 *   ※東証の新形式コード。米国ティッカーは先頭が英字（AMD/KO/JEPQ）なので衝突しない
 * - 英字始まり（`BRK.B`/`^N225` 等）→ そのまま（USD。大文字化・加工はしない）
 * - それ以外（null / 空 / 5桁以上 / 小文字混じり / 日本語 等）→ null
 */
export function toYahooSymbol(code: string | null): YahooSymbolResolution {
  if (!code) return null;
  const t = code.trim();
  if (/^\d{4}$/.test(t) || /^\d{3}[A-Z]$/.test(t)) return { symbol: `${t}.T`, currency: "JPY" };
  if (/^[A-Za-z][A-Za-z0-9.\-^=]{0,11}$/.test(t)) return { symbol: t, currency: "USD" };
  return null;
}

export const SSNB_URLS = {
  signIn: `${SSNB_BASE_URL}/users/sign_in`,
  /** ログイン後のトップ（総資産） */
  portfolio: `${SSNB_BASE_URL}/`,
  /** 口座一覧（構造化テーブル。2026-10 実測） */
  accounts: `${SSNB_BASE_URL}/accounts`,
  /** 口座別残高内訳（2026-10 実測） */
  accountShow: (accountId: string) =>
    `${SSNB_BASE_URL}/accounts/show/${accountId}`,
  /** 資産推移（旧 /asset_histories は 500 で廃止済み） */
  assetHistory: `${SSNB_BASE_URL}/bs/history`,
  /** 取引明細（常に当月分のみ。旧 /transactions/{ym} は 500 で廃止済み） */
  transactions: `${SSNB_BASE_URL}/cf`,
  /**
   * 月×カテゴリ集計（1 リクエストで直近 6 か月分を返す）。
   * 月ナビは `?base_date=YYYY/MM/DD`。
   */
  monthlyCashFlow: `${SSNB_BASE_URL}/cf/monthly`,
  /** 一括更新（全金融機関の再取得をキューに積む）。素の GET は 500 になりやすいのでリンククリック専用 */
  batchRefresh: `${SSNB_BASE_URL}/faggregation_queue2`,
} as const;

/** 口座種別（カテゴリ大分類） */
export const ACCOUNT_CATEGORIES = [
  "bank",
  "securities",
  "cash",
  "point",
  "crypto",
  "pension",
  "real_estate",
  "other",
] as const;

export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number];

/**
 * DB（accounts.category は text）に実際に入り得る語彙。
 * "card" は ssnb のクレカ口座を判別するためだけに使う（ACCOUNT_CATEGORIES の語彙は変えない）。
 */
export type StoredAccountCategory = AccountCategory | "card";

/** 口座 */
export interface Account {
  id: string;
  name: string;
  institution: string;
  category: StoredAccountCategory;
}

/** 口座の現在残高 */
export interface AccountStatus {
  accountId: string;
  /** 円建て残高（yen 表記の数値） */
  balance: number;
  /** 取得日時 (ISO 8601, UTC) */
  scrapedAt: string;
  /**
   * ssnb 的口座行的更新状態判定（本家 mfIdAccountStatus 语彙）。
   * 検出不能（正常）は undefined。db 側で既定 "ok" 扱いにする。
   */
  status?: "ok" | "error" | "updating" | "suspended";
  /** 判定根拠となった行テキスト（エラー時の表示用） */
  statusText?: string;
  /**
   * クレカの引き落とし予定額（円建て・正値）。ssnb は負値（負債）で返すため絶対値にして持つ。
   * 未定・非クレカ口座は null（誤警告を避けるため、金額と期日が揃わない限り警告しない）。
   */
  scheduledWithdrawalAmount?: number | null;
  /** クレカの引き落とし予定日 (YYYY-MM-DD)。不明は null */
  scheduledWithdrawalDate?: string | null;
}

/** 保有資産（銘柄・数量・評価額・含み損益） */
export interface Holding {
  accountId: string;
  name: string;
  /** 本家資産カテゴリ語彙（預金・現金 / 株式(現物) / 投資信託 / …）。scraper 側推定 */
  assetCategory?: string;
  /** 銘柄コード（株式のみ。投信・年金等は null）。配当シンボル解決に使う */
  code?: string | null;
  /** 数量（口座種別により意味が変わる: 株数、口数、円） */
  quantity: number;
  /** 評価額（円） */
  value: number;
  /** 平均取得単価（円）。不明時は null */
  averagePrice: number | null;
  /** 含み損益（円）。不明時は null */
  unrealizedGain: number | null;
  scrapedAt: string;
}

/** 資産推移 1日分（カテゴリ別） */
export interface AssetHistoryPoint {
  /** YYYY-MM-DD */
  date: string;
  /**
   * カテゴリ名。/bs/history のヘッダラベルをそのまま保存する（例: 預金・現金、株式(現物)、投資信託）。
   * AccountCategory では無い: web の資産構成は holdings の assetCategory（同じラベル語彙）で
   * 前日比を name 照合するため、パーサ側で語彙を写像すると結合が崩れる。
   */
  category: string;
  value: number;
}

/** 取引 1件 */
export interface Transaction {
  /** ssnb 上の取引 ID（同一性確定に使う） */
  externalId: string | null;
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** 出金は負の値に正規化 */
  amount: number;
  category: string | null;
  /** 本家 sub_category 相当。ssnb の中項目、無ければ crawler 側推定（categorizeTransaction） */
  subCategory?: string | null;
  /** 金額セルに `(振替)` が付いていたら true */
  isTransfer?: boolean;
  /** 振替先（保有金融機関セル原文、無ければ内容） */
  transferTarget?: string | null;
}

/**
 * ssnb の /cf には取引 ID が存在しないため、内容（日付・摘要・金額）と
 * 同日同内容の出現回数から決定的な externalId を合成する。
 *
 * - 再スクレイプで同じ内容は同じ ID → unique index + upsert により重複蓄積しない
 * - 同日・同額・同摘要が正当に複数ある場合も occurrence で区別され消えない
 * - 区切りに使う `:` は encodeURIComponent で必ずエスケープされるため衝突しない
 */
export function buildTransactionExternalId(
  accountId: string,
  date: string,
  description: string,
  amount: number,
  occurrence: number,
): string {
  return `ssnb-tx:${encodeURIComponent(accountId)}:${date}:${encodeURIComponent(description)}:${amount}:${occurrence}`;
}

/**
 * /cf/monthly の 1 行（行ラベルそのまま）。
 *
 * `kind` は**行名で判定**する（位置依存にしない。ssnb 側で行順が変わり得るため）:
 * - `収入合計` / `収入` → `"income"`
 * - `支出合計` / 支出カテゴリ行 → `"expense"`
 * - `収支合計` → `"balance"`（`収入合計 - 支出合計` の派生値。保存はするが合算に使わない）
 *
 * 二重計上の罠: `収入` は「収入」という唯一のカテゴリ行で `収入合計` と同額。
 * どちらもそのまま保存するが、**合計を求める時は `〜合計` 行のみ**を使うこと
 * （`収入` 行を足すと収入が 2 倍になる）。
 */
export interface MonthlyCashFlowRow {
  /** 行ラベル（`収入合計` / `支出合計` / `収支合計` / `食費` 等） */
  name: string;
  kind: "income" | "expense" | "balance";
  amount: number;
}

/** /cf/monthly の 1 か月分（月ヘッダ 1 列に対応） */
export interface MonthlyCashFlowMonth {
  /** YYYY-MM（月ヘッダ `2026/05/01〜` の先頭年月） */
  month: string;
  /** 行順はヘッダ順・行順そのまま */
  rows: MonthlyCashFlowRow[];
}

/** スクレイプ実行結果の統計 */
export interface ScrapeRun {
  startedAt: string;
  finishedAt: string;
  accountsUpserted: number;
  holdingsUpserted: number;
  transactionsUpserted: number;
  /** /cf で保有金融機関を解決できず捨てた行数（口座を取り違えて書かない代償） */
  transactionsSkipped: number;
  assetHistoryUpserted: number;
}

/** 規約遵守: ページ取得間のスリープ範囲 (ms) */
export const SLEEP_RANGE_MS = { min: 1000, max: 3000 } as const;

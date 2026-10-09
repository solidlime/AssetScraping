/** ssnb.x.moneyforward.com の URL 定数 */
export const SSNB_BASE_URL = "https://ssnb.x.moneyforward.com" as const;

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

/** 口座 */
export interface Account {
  id: string;
  name: string;
  institution: string;
  category: AccountCategory;
}

/** 口座の現在残高 */
export interface AccountStatus {
  accountId: string;
  /** 円建て残高（yen 表記の数値） */
  balance: number;
  /** 取得日時 (ISO 8601, UTC) */
  scrapedAt: string;
}

/** 保有資産（銘柄・数量・評価額・含み損益） */
export interface Holding {
  accountId: string;
  name: string;
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
  category: AccountCategory;
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
  /** 本家中項目相当。ssnb に列が無いため crawler 側推定（categorizeTransaction）で補う */
  subCategory?: string | null;
}

/** スクレイプ実行結果の統計 */
export interface ScrapeRun {
  startedAt: string;
  finishedAt: string;
  accountsUpserted: number;
  holdingsUpserted: number;
  transactionsUpserted: number;
  assetHistoryUpserted: number;
}

/** 規約遵守: ページ取得間のスリープ範囲 (ms) */
export const SLEEP_RANGE_MS = { min: 1000, max: 3000 } as const;

/**
 * スクレイパー本体: 口座一覧・残高 / 保有資産 / 資産推移 / 取引履歴。
 * 取得したデータは packages/db のリポジトリで upsert する。
 */
import {
  createDb,
  todayJst,
  upsertAccount,
  upsertAccountStatus,
  upsertAssetHistory,
  upsertDailySnapshot,
  upsertHoldings,
  upsertTransactions,
  type Database,
} from "@asset-scraping/db";
import {
  SSNB_URLS,
  type AccountCategory,
  type ScrapeRun,
} from "@asset-scraping/shared";
import { closeSession, getSession, saveStorageState, type Session } from "./auth.js";
import { FetchPage } from "./fetchPage.js";
import {
  parseAccounts,
  parseAssetHistory,
  parseHoldings,
  parseTransactions,
} from "./parse.js";

/** 取引履歴を取得する月数（通常モード） */
const RECENT_TRANSACTION_MONTHS = 2;

function monthRange(months: number): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return out;
}

/** 履歴遡行モードの上限月数（SSNB 本体が 24 ヶ月保存のため） */
const HISTORY_MONTHS = 24;

export interface RunScrapeOptions {
  /** SCRAPE_MODE=history で 24 ヶ月遡行 */
  history?: boolean;
}

export async function runScrape(db: Database, options: RunScrapeOptions = {}): Promise<ScrapeRun> {
  const startedAt = new Date().toISOString();
  const stats: ScrapeRun = {
    startedAt,
    finishedAt: "",
    accountsUpserted: 0,
    holdingsUpserted: 0,
    transactionsUpserted: 0,
    assetHistoryUpserted: 0,
  };

  const session: Session = await getSession();
  const fetcher = new FetchPage(session.page);

  try {
    // 1) 口座一覧・残高
    const portfolioHtml = await fetcher.fetch(SSNB_URLS.portfolio);
    const accounts = parseAccounts(portfolioHtml);
    for (const acc of accounts) {
      upsertAccount(db, {
        id: acc.id,
        name: acc.name,
        institution: acc.institution,
        category: acc.category as AccountCategory,
      });
      upsertAccountStatus(db, acc.status);
      upsertDailySnapshot(db, {
        accountId: acc.id,
        date: todayJst(),
        balance: acc.status.balance,
      });
      stats.accountsUpserted++;
    }

    // 2) 保有資産（口座別ページ）
    for (const acc of accounts) {
      const html = await fetcher.fetch(SSNB_URLS.holdings(acc.id));
      const holdings = parseHoldings(html, acc.id);
      upsertHoldings(db, holdings);
      stats.holdingsUpserted += holdings.length;
    }

    // 3) 資産推移
    const historyHtml = await fetcher.fetch(SSNB_URLS.assetHistory);
    const points = parseAssetHistory(historyHtml);
    upsertAssetHistory(db, points);
    stats.assetHistoryUpserted = points.length;

    // 4) 取引履歴（月次）
    const months = options.history ? HISTORY_MONTHS : RECENT_TRANSACTION_MONTHS;
    for (const { year, month } of monthRange(months)) {
      const html = await fetcher.fetch(SSNB_URLS.transactions(year, month));
      const txs = parseTransactions(html, accounts[0]?.id ?? "");
      // 口座横断の取引一覧なので全口座共通の ID で保存できない場合は
      // externalId の有無での重複排除に任せる
      const withAccount = txs.map((t) => (t.accountId ? t : { ...t, accountId: accounts[0]?.id ?? "" }));
      upsertTransactions(db, withAccount);
      stats.transactionsUpserted += withAccount.length;
    }

    // storageState を更新（セッション延命）
    if (session.didFullLogin) {
      await saveStorageState(session);
    }
  } finally {
    await closeSession(session);
  }

  stats.finishedAt = new Date().toISOString();
  return stats;
}

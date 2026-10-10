/**
 * スクレイパー本体: 口座一覧・残高 / 保有資産 / 資産推移 / 取引履歴。
 * 実測（2026-10）に合わせた取得フロー:
 *   口座一覧(/accounts) → 口座別内訳(/accounts/show/{id}) → 資産推移(/bs/history) → 取引(/cf)
 * /cf は常に当月分のみ返す（月次パラメータ無効）ため、取引は実行ごとに 1 回取得する。
 * 取得したデータは packages/db のリポジトリで upsert する。
 */
import {
  createDb,
  assignAccountCategories,
  ensureDefaultGroup,
  ensureInstitutionCategories,
  linkAllAccountsToDefaultGroup,
  regenerateCashFlowPeriods,
  todayJst,
  upsertAccount,
  upsertAccountStatus,
  upsertAssetHistory,
  upsertDailySnapshot,
  upsertHoldings,
  upsertHoldingValues,
  upsertMonthlyCashFlow,
  upsertTransactions,
  pruneHoldingsByName,
  type Database,
} from "@asset-scraping/db";
import {
  SSNB_URLS,
  type AccountCategory,
  type Holding,
  type ScrapeRun,
} from "@asset-scraping/shared";
import { closeSession, getSession, saveStorageState, type Session } from "./auth.js";
import { FetchPage } from "./fetchPage.js";
import {
  parseAccounts,
  parseAssetHistory,
  parseHoldings,
  parseMonthlyCashFlow,
  parseTransactions,
} from "./parse.js";

export interface RunScrapeOptions {
  /**
   * 実測では /cf が当月分しか返さないため履歴遡行は不可。
   * SCRAPE_MODE=history 互換のため残置するが、挙動は通常モードと同一。
   */
  history?: boolean;
}

export async function runScrape(db: Database, options: RunScrapeOptions = {}): Promise<ScrapeRun> {
  void options;
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

  // 0) 本家 queries は groupId 前提のため、default group を最初に保証する。
  // 本家 seed の「機関カテゴリ」節相当もここで保証する（bs/cf のカテゴリ集計の前提）。
  ensureDefaultGroup(db);
  ensureInstitutionCategories(db);

  try {
    // 1) 口座一覧・残高（/accounts の構造化テーブル）
    const accountsHtml = await fetcher.fetch(SSNB_URLS.accounts);
    const accounts = parseAccounts(accountsHtml);
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

    // 2) 保有資産（口座別残高内訳: /accounts/show/{id}）
    const holdingsRows: Holding[] = [];
    for (const acc of accounts) {
      const html = await fetcher.fetch(SSNB_URLS.accountShow(acc.id));
      const holdings = parseHoldings(html, acc.id, {
        category: acc.category as AccountCategory,
        accountName: acc.name,
      });
      upsertHoldings(db, holdings);
      // パーサの名前規約変更で残った旧世代行（実測 7 口座の別名二重計上）を同一口座内で掃除する。
      pruneHoldingsByName(
        db,
        acc.id,
        holdings.map((h) => h.name),
      );
      holdingsRows.push(...holdings);
      stats.holdingsUpserted += holdings.length;
    }

    // 3) 資産推移（/bs/history）
    const historyHtml = await fetcher.fetch(SSNB_URLS.assetHistory);
    const points = parseAssetHistory(historyHtml);
    upsertAssetHistory(db, points);
    stats.assetHistoryUpserted = points.length;

    // 4) 取引明細（/cf、常に当月分。口座横断のため先頭口座に紐付けて保存）
    const cfHtml = await fetcher.fetch(SSNB_URLS.transactions);
    const txs = parseTransactions(cfHtml, accounts[0]?.id ?? "");
    upsertTransactions(db, txs);
    stats.transactionsUpserted = txs.length;

    // 4b) 月×カテゴリ集計（/cf/monthly、1 リクエストで 6 か月分）。
    // 過去月の金額はここでしか取れない。失敗しても他の取得を巻き込まないよう fail-soft にする。
    try {
      const monthlyHtml = await fetcher.fetch(SSNB_URLS.monthlyCashFlow);
      const months = parseMonthlyCashFlow(monthlyHtml);
      upsertMonthlyCashFlow(db, months);
    } catch {
      // 取れなければ既存の cash_flow_monthly を維持（過去月は前回分のまま）
    }

    // 5) 本家互換派生テーブル: holding_values / cash_flow_periods / group_accounts。
    // institution_categories が確定した時点で accounts.category_id を自動割当する
    // （null のみ。既存の割当は保持）。bs のバランスシート・cf のカテゴリ内訳の前提。
    upsertHoldingValues(db, holdingsRows, todayJst());
    regenerateCashFlowPeriods(db);
    linkAllAccountsToDefaultGroup(db);
    assignAccountCategories(db);

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

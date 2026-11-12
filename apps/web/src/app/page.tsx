import { getDb, getLastScrapeResult, hasInvestmentHoldings, type ScrapeFailureKind } from "@asset-scraping/db";
import type { Metadata } from "next";
import { AssetBreakdownChart } from "../components/info/asset-breakdown-chart";
import { AssetHistoryChart } from "../components/info/asset-history-chart";
import { DailyChangeCard } from "../components/info/daily-change-card";
import { MonthlyBalanceCard } from "../components/info/monthly-balance-card";
import { MonthlyIncomeExpenseChart } from "../components/info/monthly-income-expense-chart";
import { UpcomingWithdrawalsCard } from "../components/info/upcoming-withdrawals-card";
import { PageLayout } from "../components/layout/page-layout";

export const metadata: Metadata = {
  title: "ダッシュボード",
};

export const dynamic = "force-dynamic";

/** バナー用の JST 整形（YYYY/MM/DD HH:mm）。未取得は「なし」 */
function formatJst(iso: string | undefined): string {
  if (!iso) return "なし";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 失敗理由ごとのバナー文言 */
function failureMessage(kind: ScrapeFailureKind | undefined): string {
  switch (kind) {
    case "session_expired":
      return "SSNB のセッションが失効しています。データが更新されていません。";
    case "two_factor":
      return "SSNB が二段階認証を要求しています。認証コードの入力が必要です。";
    case "login_required":
      return "SSNB へのログインに失敗しました。設定タブの認証情報を確認してください。";
    default:
      return "直近のデータ取得に失敗しました。";
  }
}

/** 24時間以上成功していない（または失敗している）間はバナーを出す */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export default async function DashboardPage() {
  const showDailyChange = await hasInvestmentHoldings();
  const lastScrape = getLastScrapeResult(getDb());
  const lastSuccessAge = lastScrape?.lastSuccessAt
    ? Date.now() - Date.parse(lastScrape.lastSuccessAt)
    : Number.NaN;
  const showScrapeBanner = lastScrape !== null && !(lastScrape.ok && lastSuccessAge < STALE_AFTER_MS);

  return (
    <PageLayout title="ダッシュボード">
      {showScrapeBanner && lastScrape && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">{failureMessage(lastScrape.kind)}</p>
          <p className="mt-1">
            最終成功: {formatJst(lastScrape.lastSuccessAt)} / 失敗: {formatJst(lastScrape.finishedAt)}
            {lastScrape.error ? `（${lastScrape.error.slice(0, 120)}）` : ""}
          </p>
        </div>
      )}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <AssetBreakdownChart className="lg:col-span-2" />
        <MonthlyBalanceCard />
      </div>

      <UpcomingWithdrawalsCard />

      {showDailyChange && <DailyChangeCard />}

      <AssetHistoryChart />

      <MonthlyIncomeExpenseChart />
    </PageLayout>
  );
}

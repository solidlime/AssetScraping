import { getDb, getDividendForecast, schema } from "@asset-scraping/db";
import { max } from "drizzle-orm";
import { Coins, PiggyBank, TableProperties, TrendingUp, Wallet } from "lucide-react";
import type { Metadata } from "next";
import {
  DividendSyncButton,
  DividendUnresolvedList,
} from "../../components/dividends/dividend-actions.client";
import { DividendCalendarChartClient } from "../../components/charts/lazy-charts.client";
import { PageLayout } from "../../components/layout/page-layout";
import { AmountDisplay } from "../../components/ui/amount-display";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { formatDateTime, formatMonth, formatNumber, formatPercent } from "../../lib/format";
import { dividendRowStatus, REASON_OUT_OF_SCOPE, toUnresolvedItems } from "../../lib/dividend-utils";
export const metadata: Metadata = {
  title: "配当・分配",
};

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  const db = getDb();
  const [forecast, eventFetch, fxFetch] = await Promise.all([
    getDividendForecast(db),
    Promise.resolve(
      db.select({ at: max(schema.dividendEvents.fetchedAt) }).from(schema.dividendEvents).get(),
    ),
    Promise.resolve(db.select({ at: max(schema.fxRates.fetchedAt) }).from(schema.fxRates).get()),
  ]);

  const currentMonth = forecast.currentMonth;
  const yearDiff = forecast.next12MonthsJpy - forecast.lastYearJpy;
  const yearDiffPct =
    forecast.lastYearJpy === 0 ? null : (yearDiff / forecast.lastYearJpy) * 100;

  const unresolvedItems = toUnresolvedItems(forecast);

  // 配当対象外（対象外カテゴリ）はメインテーブルから外し、折りたたみで表示する
  const outOfScopeRows = forecast.rows.filter((row) => row.reason === REASON_OUT_OF_SCOPE);
  const dividendRows = forecast.rows.filter((row) => row.reason !== REASON_OUT_OF_SCOPE);

  return (
    <PageLayout title="配当・分配" options={<DividendSyncButton />}>
      <div className="space-y-6">
        {/* 1. 今月の見込み（主役） + 2. 今後12ヶ月 / 前年実績 */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle icon={Coins}>今月の配当・分配見込み</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm text-muted-foreground">{formatMonth(currentMonth.month)}</div>
              <AmountDisplay amount={currentMonth.totalJpy} size="2xl" weight="bold" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  確定（配当落ち） <AmountDisplay amount={currentMonth.confirmedJpy} size="sm" />
                </span>
                <span>
                  推定（月末までの見込み） <AmountDisplay amount={currentMonth.estimatedJpy} size="sm" />
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                ※ 配当落ち日ベースの見込みです。実際の入金は銘柄により数週間〜数ヶ月後になります。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle icon={TrendingUp}>今後12ヶ月の見込み</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <AmountDisplay amount={forecast.next12MonthsJpy} size="xl" weight="semibold" />
              <div className="text-sm text-muted-foreground">
                前年実績比{" "}
                <AmountDisplay amount={yearDiff} showSign size="sm" />
                {yearDiffPct !== null && <>（{formatPercent(yearDiffPct)}）</>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle icon={PiggyBank}>前年実績（参考）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <AmountDisplay amount={forecast.lastYearJpy} size="xl" weight="semibold" />
              <div className="text-sm text-muted-foreground">
                現在の保有数量で昨年実績を換算した近似値
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 3. 12ヶ月カレンダー（グラフ + 月クリック内訳） */}
        <DividendCalendarChartClient months={forecast.months} payoutMonths={forecast.payoutMonths} />

        {/* 4. 銘柄別テーブル */}
        <Card>
          <CardHeader>
            <CardTitle icon={TableProperties}>銘柄別の内訳</CardTitle>
          </CardHeader>
          <CardContent>
            {dividendRows.length === 0 ? (
              <EmptyState icon={TableProperties} message="配当対象の保有銘柄がありません" />
            ) : (
              <div className="overflow-x-auto">
                <p className="mb-2 text-xs text-muted-foreground">対象 {dividendRows.length}件</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">銘柄名</th>
                      <th scope="col" className="py-2 pr-4 font-medium">コード</th>
                      <th scope="col" className="py-2 pr-4 font-medium">カテゴリ</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">数量</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">評価額</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">年間見込み</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">月平均（直近3ヶ月）</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">利回り</th>
                      <th scope="col" className="py-2 pr-4 font-medium">解決状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendRows.map((row) => {
                      const status = dividendRowStatus(row);
                      return (
                        <tr key={row.holdingName} className="border-b last:border-0">
                          <td className="py-2 pr-4">
                            <div className="font-medium">{row.holdingName}</div>
                            {row.yahooSymbol && (
                              <div className="text-xs text-muted-foreground">{row.yahooSymbol}</div>
                            )}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">{row.code ?? "—"}</td>
                          <td className="py-2 pr-4">{row.category ?? "—"}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatNumber(row.quantity)}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            <AmountDisplay amount={row.value} size="sm" />
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {row.annualAmountJpy === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <AmountDisplay amount={row.annualAmountJpy} size="sm" />
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {row.monthlyAmountJpy === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <AmountDisplay amount={row.monthlyAmountJpy} size="sm" />
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {row.yieldPct === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              formatPercent(row.yieldPct, 2)
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge variant={status.variant}>{status.label}</Badge>
                            {!row.resolved && row.reason && (
                              <div className="mt-1 text-xs text-muted-foreground">{row.reason}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  ※ 月平均は直近3ヶ月の実績平均です（年間見込み ÷ 12 ではありません）。
                </p>
              </div>
            )}
            {outOfScopeRows.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  配当対象外の口座・資産 {outOfScopeRows.length}件
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th scope="col" className="py-2 pr-4 font-medium">銘柄名</th>
                        <th scope="col" className="py-2 pr-4 font-medium">カテゴリ</th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">評価額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outOfScopeRows.map((row) => (
                        <tr key={row.holdingName} className="border-b last:border-0">
                          <td className="py-2 pr-4">{row.holdingName}</td>
                          <td className="py-2 pr-4">{row.category ?? "—"}</td>
                          <td className="py-2 pr-4 text-right">
                            <AmountDisplay amount={row.value} size="sm" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </CardContent>
        </Card>

        {/* 5. 要対応（未解決） */}
        <Card>
          <CardHeader>
            <CardTitle icon={Wallet}>要対応（未解決の銘柄）</CardTitle>
          </CardHeader>
          <CardContent>
            <DividendUnresolvedList items={unresolvedItems} />
          </CardContent>
        </Card>

        {/* 6. データ鮮度 */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            為替（USD/JPY）:{" "}
            {forecast.fxUsdJpy === null ? "未取得" : `${forecast.fxUsdJpy.toFixed(2)} 円`}
          </span>
          <span>配当イベント最終取得: {eventFetch?.at ? formatDateTime(eventFetch.at) : "未取得"}</span>
          <span>為替最終取得: {fxFetch?.at ? formatDateTime(fxFetch.at) : "未取得"}</span>
        </div>

        {/* 8. 免責 */}
        <p className="text-xs text-muted-foreground">
          本ページの金額は過去実績および手動入力値からの推定であり、将来の受取を保証するものではありません。投信の年間分配金は手動入力値、ETF の分配金は変動します（カバードコール型は特に変動が大きくなります）。為替換算は現在レート固定のため、実際の受取額とは異なる場合があります。
        </p>
      </div>
    </PageLayout>
  );
}

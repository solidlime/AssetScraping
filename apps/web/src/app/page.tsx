import {
  AssetHistoryChart,
  type AssetHistorySeriesPoint,
} from "@/components/AssetHistoryChart";
import { RefreshButton } from "@/components/RefreshButton";
import { formatYen } from "@/lib/format";
import { loadDashboardData } from "@/lib/data";
import type { AccountCategory } from "@asset-scraping/shared";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  bank: "預金・銀行",
  securities: "証券",
  cash: "現金",
  point: "ポイント",
  crypto: "暗号資産",
  pension: "年金",
  real_estate: "不動産",
  other: "その他",
};

export default function DashboardPage() {
  const data = loadDashboardData();

  const statusByAccount = new Map(data.statuses.map((s) => [s.accountId, s]));
  const total = data.statuses.reduce((sum, s) => sum + s.balance, 0);
  const byCategory = new Map<AccountCategory, number>();
  for (const s of data.statuses) {
    const acc = data.accounts.find((a) => a.id === s.accountId);
    const cat = acc?.category ?? "other";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + s.balance);
  }

  // 資産推移を日付 × カテゴリのワイド形式に整形
  const byDate = new Map<string, Partial<Record<AccountCategory, number>>>();
  for (const p of data.assetHistory) {
    const row = byDate.get(p.date) ?? {};
    row[p.category] = (row[p.category] ?? 0) + p.value;
    byDate.set(p.date, row);
  }
  const chartData: AssetHistorySeriesPoint[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({ date, ...row }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">資産ダッシュボード</h1>
          <p className="text-sm text-neutral-500">
            Money Forward SSNB
            {data.lastScrapedAt
              ? ` — 最終取得: ${new Date(data.lastScrapedAt).toLocaleString("ja-JP")}`
              : " — データ未取得"}
          </p>
        </div>
        <RefreshButton />
      </header>

      <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">総資産</h2>
        <p className="text-4xl font-bold tabular-nums">{formatYen(total)}</p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
          {[...byCategory.entries()].map(([cat, v]) => (
            <li key={cat}>
              {CATEGORY_LABELS[cat]}: <span className="font-semibold tabular-nums">{formatYen(v)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">口座別残高</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2">口座</th>
              <th className="py-2">分類</th>
              <th className="py-2 text-right">残高</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.id} className="border-b border-neutral-100">
                <td className="py-2">
                  {a.name}
                  <span className="ml-2 text-xs text-neutral-400">{a.institution}</span>
                </td>
                <td className="py-2 text-neutral-600">{CATEGORY_LABELS[a.category]}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatYen(statusByAccount.get(a.id)?.balance ?? 0)}
                </td>
              </tr>
            ))}
            {data.accounts.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-neutral-400">
                  データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">資産推移</h2>
        <AssetHistoryChart data={chartData} />
      </section>

      <section className="mb-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">月次収支</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-2">月</th>
                <th className="py-2 text-right">収入</th>
                <th className="py-2 text-right">支出</th>
                <th className="py-2 text-right">収支</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => (
                <tr key={m.month} className="border-b border-neutral-100">
                  <td className="py-2">{m.month}</td>
                  <td className="py-2 text-right tabular-nums">{formatYen(m.income)}</td>
                  <td className="py-2 text-right tabular-nums">{formatYen(m.expense)}</td>
                  <td className={`py-2 text-right tabular-nums ${m.net >= 0 ? "text-blue-700" : "text-red-700"}`}>
                    {formatYen(m.net)}
                  </td>
                </tr>
              ))}
              {data.monthly.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-neutral-400">
                    データがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">取引履歴（直近 200 件）</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-2">日付</th>
                <th className="py-2">内容</th>
                <th className="py-2 text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t, i) => (
                <tr key={`${t.date}-${t.externalId ?? i}`} className="border-b border-neutral-100">
                  <td className="py-2 whitespace-nowrap">{t.date}</td>
                  <td className="py-2">
                    {t.description}
                    {t.category && <span className="ml-2 text-xs text-neutral-400">{t.category}</span>}
                  </td>
                  <td className={`py-2 text-right tabular-nums ${t.amount < 0 ? "text-red-700" : "text-blue-700"}`}>
                    {formatYen(t.amount)}
                  </td>
                </tr>
              ))}
              {data.transactions.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-neutral-400">
                    データがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

import {
  getDb,
  getUpcomingWithdrawals,
  getWithdrawalAlertDays,
  summarizeWithdrawalShortages,
} from "@asset-scraping/db";
import { CreditCard } from "lucide-react";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

/** F7 フォローアップ: 引き落とし間近のクレカ・固定費の予定（不足していなくても見せる） */
export function UpcomingWithdrawalsCard() {
  const db = getDb();
  const upcoming = getUpcomingWithdrawals(db);
  if (upcoming.length === 0) return null;

  const alertDays = getWithdrawalAlertDays(db);
  // 行の shortage はカードと固定費で別集計なので、口座単位に合算した値で出す
  const shortages = summarizeWithdrawalShortages(upcoming);
  const shortageByAccount = new Map(shortages.map((s) => [s.withdrawalAccountId, s]));
  const totalShortage = shortages.reduce((sum, s) => sum + s.shortage, 0);

  // 引落元口座ごとにまとめる。同じ不足額を全行に繰り返さないため
  const groups: { id: string; name: string; items: typeof upcoming }[] = [];
  const groupIndex = new Map<string, number>();
  for (const item of upcoming) {
    const id = item.withdrawalAccountId ?? "";
    const idx = groupIndex.get(id);
    if (idx === undefined) {
      groupIndex.set(id, groups.length);
      groups.push({ id, name: item.withdrawalAccountName ?? "引落元 未設定", items: [item] });
    } else {
      groups[idx]!.items.push(item);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={CreditCard}>引き落とし間近の予定</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {groups.map((group) => {
            const shortage = shortageByAccount.get(group.id);
            return (
              <li key={group.id || "none"}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-foreground">{group.name}</span>
                  {shortage && (
                    <Badge variant="warning">
                      不足 {shortage.shortage.toLocaleString("ja-JP")}円
                    </Badge>
                  )}
                </div>
                {shortage && (
                  <p className="text-xs text-muted-foreground">
                    残高 {shortage.balance.toLocaleString("ja-JP")}円 / 引き落とし{" "}
                    {shortage.amount.toLocaleString("ja-JP")}円
                  </p>
                )}
                <ul className="mt-1 space-y-1">
                  {group.items.map((item) => (
                    <li
                      key={`${item.accountId}-${item.date}-${item.paymentName ?? ""}`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                    >
                      <span className="text-muted-foreground">{item.date.slice(5)}</span>
                      <span>{item.paymentName ?? item.accountName}</span>
                      {item.kind === "payment" && <Badge variant="secondary">固定費</Badge>}
                      <span className="font-medium">{item.amount.toLocaleString("ja-JP")}円</span>
                      <span className="text-xs text-muted-foreground">
                        {item.remainingDays === 0 ? "今日" : `${item.remainingDays}日後`}
                      </span>
                      {item.note && <span className="text-xs text-muted-foreground">{item.note}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
        {totalShortage > 0 && (
          <p className="mt-3 text-sm font-semibold text-yellow-700">
            引き落とし資金の不足合計 {totalShortage.toLocaleString("ja-JP")}円
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          引き落とし日が直近 {alertDays} 日以内、または金額が確定した予定を表示しています。
        </p>
      </CardContent>
    </Card>
  );
}

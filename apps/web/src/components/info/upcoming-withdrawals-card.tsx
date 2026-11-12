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
  const shortageByAccount = new Map(shortages.map((s) => [s.withdrawalAccountId, s.shortage]));
  const totalShortage = shortages.reduce((sum, s) => sum + s.shortage, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={CreditCard}>引き落とし間近の予定</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {upcoming.map((item) => (
            <li
              key={`${item.accountId}-${item.date}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            >
              <span className="text-muted-foreground">{item.date}</span>
              <span className="font-semibold text-foreground">{item.paymentName ?? item.accountName}</span>
              {item.kind === "payment" && <Badge variant="secondary">固定費</Badge>}
              <span>{item.amount.toLocaleString("ja-JP")}円</span>
              {item.withdrawalAccountName && <span>引き落とし元 {item.withdrawalAccountName}</span>}
              <span className="text-xs text-muted-foreground">
                {item.remainingDays === 0 ? "今日" : `あと${item.remainingDays}日`}
              </span>
              {shortageByAccount.has(item.withdrawalAccountId ?? "") && (
                <Badge variant="warning">
                  この口座で残高不足 {shortageByAccount.get(item.withdrawalAccountId ?? "")!.toLocaleString("ja-JP")}円
                </Badge>
              )}
              {item.note && <span className="text-xs text-muted-foreground">{item.note}</span>}
            </li>
          ))}
        </ul>
        {totalShortage > 0 && (
          <p className="mt-3 text-sm font-semibold text-yellow-700">
            引き落とし資金の不足合計 {totalShortage.toLocaleString("ja-JP")}円
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          引き落とし日が直近 {alertDays} 日以内の予定を表示しています。
        </p>
      </CardContent>
    </Card>
  );
}

import { getDb, getUpcomingWithdrawals, getWithdrawalAlertDays } from "@asset-scraping/db";
import { CreditCard } from "lucide-react";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

/** F7 フォローアップ: 引き落とし間近のクレカ予定（不足していなくても見せる） */
export function UpcomingWithdrawalsCard() {
  const db = getDb();
  const upcoming = getUpcomingWithdrawals(db);
  if (upcoming.length === 0) return null;

  const alertDays = getWithdrawalAlertDays(db);

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={CreditCard}>引き落とし間近のクレカ</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {upcoming.map((item) => (
            <li
              key={`${item.accountId}-${item.date}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            >
              <span className="text-muted-foreground">{item.date}</span>
              <span className="font-semibold text-foreground">{item.accountName}</span>
              <span>{item.amount.toLocaleString("ja-JP")}円</span>
              {item.withdrawalAccountName && <span>引き落とし元 {item.withdrawalAccountName}</span>}
              <span className="text-xs text-muted-foreground">
                {item.remainingDays === 0 ? "今日" : `あと${item.remainingDays}日`}
              </span>
              {item.shortage !== undefined && (
                <Badge variant="warning">
                  残高不足 {item.shortage.toLocaleString("ja-JP")}円
                </Badge>
              )}
              {item.note && <span className="text-xs text-muted-foreground">{item.note}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          引き落とし日が直近 {alertDays} 日以内の予定を表示しています。
        </p>
      </CardContent>
    </Card>
  );
}

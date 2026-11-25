import {
  getDb,
  getUpcomingWithdrawals,
  getWithdrawalAlertDays,
  summarizeWithdrawals,
} from "@asset-scraping/db";
import { CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { WithdrawalGroups } from "./withdrawal-groups";

/** F7 フォローアップ: 引き落とし間近のクレカ・固定費の予定（不足していなくても見せる） */
export function UpcomingWithdrawalsCard() {
  const db = getDb();
  const upcoming = getUpcomingWithdrawals(db);
  if (upcoming.length === 0) return null;

  const alertDays = getWithdrawalAlertDays(db);
  // 行の shortage はカードと固定費で別集計なので、口座単位に合算した値で出す
  const summaries = summarizeWithdrawals(upcoming);
  const totalShortage = summaries.reduce((sum, s) => sum + s.shortage, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={CreditCard}>引き落とし間近の予定</CardTitle>
      </CardHeader>
      <CardContent>
        <WithdrawalGroups summaries={summaries} />
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

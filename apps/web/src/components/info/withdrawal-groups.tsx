import type { WithdrawalShortage } from "@asset-scraping/db";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/badge";

/**
 * 引落元口座ごとの引き落とし予定。ダッシュボードと /accounts で同じ表示にする共通部品。
 * `summaries` は `summarizeWithdrawals`（口座単位の合算）の結果をそのまま渡す。
 */
export function WithdrawalGroups({ summaries }: { summaries: WithdrawalShortage[] }) {
  return (
    <ul className="space-y-4">
      {summaries.map((summary) => {
        // 引き落とし後残高は口座単位の合算額で引く（行ごとに引くと残高を二重に使う）
        const after = summary.balance - summary.amount;
        return (
          <li key={summary.withdrawalAccountId}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-foreground">
                {summary.withdrawalAccountName || "引落元 未設定"}
              </span>
              {summary.shortage > 0 && (
                <Badge variant="warning">
                  不足 {summary.shortage.toLocaleString("ja-JP")}円
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              残高 {summary.balance.toLocaleString("ja-JP")}円 / 引き落とし{" "}
              {summary.amount.toLocaleString("ja-JP")}円 / 引き落とし後{" "}
              <span className={cn("font-medium", after < 0 && "text-destructive")}>
                {after.toLocaleString("ja-JP")}円
              </span>
            </p>
            <ul className="mt-1 space-y-1">
              {summary.items.map((item) => (
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
  );
}

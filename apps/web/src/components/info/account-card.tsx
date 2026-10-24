import type { AccountStatusType } from "@asset-scraping/db";
import { formatLastUpdated } from "../../lib/format";
import { AccountStatusBadge } from "../ui/account-status-badge";
import { AmountDisplay } from "../ui/amount-display";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";

type AccountCardProps = {
  mfId: string;
  name: string;
  type: string;
  status: AccountStatusType;
  lastUpdated: string | null;
  totalAssets: number;
  /** カテゴリ名（未分類は "未分類"） — クレカカード判定に使う */
  categoryName: string;
  /** accounts.category（"bank" / "card" 等）。本番 DB は category_id が未充填のためこちらで判定する */
  category?: string;
  /** F7: クレカの引き落とし予定額（正値） */
  scheduledWithdrawalAmount?: number | null;
  /** F7: 引き落とし予定日 (YYYY-MM-DD) */
  scheduledWithdrawalDate?: string | null;
};

export function AccountCard({
  mfId,
  name,
  type,
  status,
  lastUpdated,
  totalAssets,
  categoryName,
  category,
  scheduledWithdrawalAmount,
  scheduledWithdrawalDate,
}: AccountCardProps) {
  const href = `/accounts/${mfId}`;
  const isLinkable = mfId !== "unknown";

  return (
    <Card
      href={isLinkable ? href : undefined}
      className={isLinkable ? "border-primary/30 hover:border-primary transition-colors" : ""}
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <span className="font-semibold text-foreground">{name}</span>
          <Badge variant="outline">{type}</Badge>
        </div>

        <div className="mb-3">
          <AmountDisplay amount={totalAssets} size="2xl" weight="bold" />
        </div>

        {scheduledWithdrawalAmount != null && scheduledWithdrawalDate ? (
          <div className="mb-3 text-sm text-muted-foreground">
            引き落とし予定: {scheduledWithdrawalAmount.toLocaleString("ja-JP")}円
            （{scheduledWithdrawalDate}）
          </div>
        ) : (
          // クレカで予定額が取れていない場合、「警告なし」と区別できるよう状態だけ出す（数字は出さない）
          (categoryName === "カード" || category === "card") && (
            <div className="mb-3 text-sm text-muted-foreground">引落予定：未定</div>
          )
        )}

        <div className="flex items-center justify-between h-5">
          <div className="flex items-center gap-2">
            {type !== "手動" && <AccountStatusBadge status={status} />}
          </div>
          {type !== "手動" && formatLastUpdated(lastUpdated) && (
            <span className="text-sm text-muted-foreground">
              取得日時: {formatLastUpdated(lastUpdated)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

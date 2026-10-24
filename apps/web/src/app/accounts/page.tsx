import { getAccountAlerts, getAccountsGroupedByCategory, getDb, getWithdrawalAccountState } from "@asset-scraping/db";
import { CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { PageLayout } from "../../components/layout/page-layout";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { AccountListClient } from "./account-list.client";

export const metadata: Metadata = {
  title: "連携サービス一覧",
};

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const groupedAccounts = await getAccountsGroupedByCategory();

  // 自動連携のみカウント（手動はステータス不明のため除外）
  const allAccounts = groupedAccounts.flatMap((group) => group.accounts);
  const autoAccounts = allAccounts.filter((a) => a.type !== "手動");
  const okCount = autoAccounts.filter((a) => a.status === "ok").length;
  const errorCount = autoAccounts.filter((a) => a.status === "error").length;

  // 口座警告（低残高・異常ステータス・引き落とし残高不足）。件数は**口座数**で数える
  // （同じ口座が low_balance と scheduled_withdrawal の両方に載るため、行数で数えると二重計上になる）
  const alerts = getAccountAlerts(getDb());
  const alertCount = new Set(alerts.map((a) => a.accountId)).size;
  // F7: クレカ引き落としの残高不足警告（内容を見せる）
  const withdrawalAlerts = alerts.filter((a) => a.kind === "scheduled_withdrawal");
  // 引き落とし口座が未設定（かつ銀行口座が複数で自動代用できない）ならその旨を出す
  const withdrawalAccount = getWithdrawalAccountState(getDb());
  const withdrawalNote = withdrawalAlerts.find((a) => a.note)?.note;

  return (
    <PageLayout
      title="連携サービス一覧"
      options={
        <>
          <Badge variant="success">正常: {okCount}件</Badge>
          <Badge variant="destructive">エラー: {errorCount}件</Badge>
          {alertCount > 0 && (
            <Badge variant="warning">警告: {alertCount}件</Badge>
          )}
        </>
      }
    >
      {withdrawalAlerts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle icon={CreditCard}>引き落とし残高不足のおそれ</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {withdrawalAlerts.map((alert) => (
                <li key={`${alert.accountId}-${alert.scheduledWithdrawalDate}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge variant="warning">残高不足</Badge>
                  <span className="font-semibold text-foreground">{alert.accountName}</span>
                  <span>予定額 {(alert.scheduledWithdrawalAmount ?? 0).toLocaleString("ja-JP")}円</span>
                  <span>引き落とし日 {alert.scheduledWithdrawalDate}</span>
                  <span className="text-destructive">不足額 {(alert.shortage ?? 0).toLocaleString("ja-JP")}円</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              ssnb の引き落とし予定額が
              {withdrawalAccount.accountName ? `「${withdrawalAccount.accountName}」` : "引き落とし口座"}
              の残高を超えています。金額・期日が未確定のカードは表示しません。
            </p>
            {withdrawalNote && <p className="mt-1 text-xs text-muted-foreground">{withdrawalNote}</p>}
          </CardContent>
        </Card>
      )}
      {withdrawalAccount.status === "ambiguous" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle icon={CreditCard}>引き落とし口座が未設定です</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              銀行口座が複数あるため、引き落とし残高の比較に使う口座が決まっていません。設定タブで「引き落とし口座」を選ぶと警告を出します。
            </p>
          </CardContent>
        </Card>
      )}
      <AccountListClient groupedAccounts={groupedAccounts} />
    </PageLayout>
  );
}

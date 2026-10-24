import { getAccountAlerts, getAccountsGroupedByCategory, getDb } from "@asset-scraping/db";
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

  // 口座警告（低残高・異常ステータス）の件数バッジ（getAccountAlerts は現在残高ベース）
  const alerts = getAccountAlerts(getDb());
  const alertCount = alerts.length;
  // F7: クレカ引き落としの残高不足警告（内容を見せる）
  const withdrawalAlerts = alerts.filter((a) => a.kind === "scheduled_withdrawal");

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
              引き落とし口座の残高と ssnb の引き落とし予定額の比較です。金額・期日が未確定のカードは表示しません。
            </p>
          </CardContent>
        </Card>
      )}
      <AccountListClient groupedAccounts={groupedAccounts} />
    </PageLayout>
  );
}

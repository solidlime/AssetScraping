import { getAccountAlerts, getAccountsGroupedByCategory, getDb, getWithdrawalAccountState, getWithdrawalAlertDays } from "@asset-scraping/db";
import { CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { PageLayout } from "../../components/layout/page-layout";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { listUnresolvedWithdrawals, listWithdrawalShortages } from "../../lib/account-alerts";
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
  // 型は optional だが、kind==="scheduled_withdrawal" では生成側が必ず予定額を入れる
  // （下の JSX の `scheduledWithdrawalAmount ?? 0` は到達不能。型の都合で残している）
  const withdrawalAlerts = alerts.filter((a) => a.kind === "scheduled_withdrawal");
  // 引き落とし口座が未設定（かつ銀行口座が複数で自動代用できない）ならその旨を出す。
  // 注: getWithdrawalAccountState は**既定（グローバル）設定しか見ない**。カード別リンクは見ないので、
  // 全カードにリンク済みでもここは出る（文言側で「カード別に指定済みのものは判定済み」と補足する）
  const withdrawalAccount = getWithdrawalAccountState(getDb());
  // shortage 未定義＝引き落とし口座を解決できていない警告。不足額リストには入れない（shortage ?? 0 にしない）
  const resolvedAlerts = withdrawalAlerts.filter((a) => a.shortage !== undefined);
  const unresolvedAlerts = listUnresolvedWithdrawals(withdrawalAlerts);
  const shortageRows = listWithdrawalShortages(withdrawalAlerts);
  const alertDays = getWithdrawalAlertDays(getDb());

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
      {resolvedAlerts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle icon={CreditCard}>引き落とし残高不足のおそれ</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {resolvedAlerts.map((alert) => (
                <li key={`${alert.accountId}-${alert.scheduledWithdrawalDate}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge variant="warning">残高不足</Badge>
                  <span className="font-semibold text-foreground">{alert.accountName}</span>
                  <span>予定額 {(alert.scheduledWithdrawalAmount ?? 0).toLocaleString("ja-JP")}円</span>
                  <span>引き落とし日 {alert.scheduledWithdrawalDate}</span>
                </li>
              ))}
            </ul>
            <ul className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
              {shortageRows.map((item) => (
                <li key={item.accountId} className="flex flex-wrap items-center gap-x-3 text-destructive">
                  <span className="text-foreground">「{item.name}」の不足額</span>
                  <span>{item.shortage.toLocaleString("ja-JP")}円</span>
                  <span className="text-xs text-muted-foreground">（同じ口座を共有するカードの予定額を合算）</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              ssnb の引き落とし予定額が引き落とし口座の残高を超えています。不足額は口座単位の合算値で、
              引き落とし日が直近 {alertDays} 日以内（窓内）の予定のみを合算しています。金額・期日が未確定のカードは表示しません。
            </p>
          </CardContent>
        </Card>
      )}
      {unresolvedAlerts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle icon={CreditCard}>引き落とし口座を解決できません</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {unresolvedAlerts.map((alert) => (
                <li key={`${alert.accountId}-${alert.scheduledWithdrawalDate}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-foreground">{alert.accountName}</span>
                  <span>予定額 {(alert.scheduledWithdrawalAmount ?? 0).toLocaleString("ja-JP")}円</span>
                  <span>引き落とし日 {alert.scheduledWithdrawalDate}</span>
                  {alert.note && <span className="text-xs text-muted-foreground">{alert.note}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              引き落とし口座が削除済み・カード扱いのため、残高との比較ができません。不足額は表示しません（0円ではありません）。
              設定タブで引き落とし口座を選び直してください。
            </p>
          </CardContent>
        </Card>
      )}
      {(withdrawalAccount.status === "ambiguous" || withdrawalAccount.status === "none") && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle icon={CreditCard}>既定の引き落とし口座が未設定です</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {withdrawalAccount.status === "ambiguous"
                ? "銀行口座が複数あるため、引き落とし残高の比較に使う既定の口座が決まっていません。"
                : "銀行系の口座が見つからないため、引き落とし残高の比較ができません。"}
              設定タブで「引き落とし口座（既定）」またはカード別の引き落とし口座を選ぶと警告を出します。
              この判定は既定値のみを見ており、カード別に指定済みのカードは個別に判定されています。
            </p>
          </CardContent>
        </Card>
      )}
      <AccountListClient groupedAccounts={groupedAccounts} />
    </PageLayout>
  );
}

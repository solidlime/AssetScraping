import { countUnresolvedCards, getAccountAlerts, getAccountsGroupedByCategory, getDb, getUpcomingWithdrawals, getWithdrawalAccountState, getWithdrawalAlertDays, summarizeWithdrawals } from "@asset-scraping/db";
import { CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { PageLayout } from "../../components/layout/page-layout";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { WithdrawalGroups } from "../../components/info/withdrawal-groups";
import { listUnresolvedWithdrawals } from "../../lib/account-alerts";
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

  const db = getDb();
  // 口座警告（低残高・異常ステータス・引き落とし残高不足）。件数は**口座数**で数える
  // （同じ口座が low_balance と scheduled_withdrawal の両方に載るため、行数で数えると二重計上になる）
  const alerts = getAccountAlerts(db);
  const alertCount = new Set(alerts.map((a) => a.accountId)).size;
  // F7: クレカ引き落としの残高不足警告。ダッシュボードと同じ表示（引落元口座ごとにまとめる）にするため
  // 同じ経路（getUpcomingWithdrawals）から引く。不足している口座のグループだけを出す
  const upcoming = getUpcomingWithdrawals(db);
  const shortages = summarizeWithdrawals(upcoming).filter((s) => s.shortage > 0);
  // 引き落とし口座が未解決のカードがある時だけ「未設定」カードを出す。
  // 注: getWithdrawalAccountState は**既定（グローバル）設定しか見ない**ので、カード別リンクで解決できるカードは
  // 数えない countUnresolvedCards と併用する（既定が ambiguous でも全カード個別リンク済みなら警告不要）
  const withdrawalAccount = getWithdrawalAccountState(db);
  const unresolvedCardCount = countUnresolvedCards(db);
  // shortage 未定義＝引き落とし口座を解決できていない警告。不足額リストには入れない（shortage ?? 0 にしない）
  const unresolvedAlerts = listUnresolvedWithdrawals(
    alerts.filter((a) => a.kind === "scheduled_withdrawal"),
  );
  const alertDays = getWithdrawalAlertDays(db);

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
      {shortages.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle icon={CreditCard}>引き落とし残高不足のおそれ</CardTitle>
          </CardHeader>
          <CardContent>
            <WithdrawalGroups summaries={shortages} />
            <p className="mt-3 text-xs text-muted-foreground">
              引き落とし後の残高がマイナスになる口座を表示しています（不足額・残高・引き落とし額はすべて引落元口座単位の
              合算値）。引き落とし日が直近 {alertDays} 日以内、または金額が確定した予定のみを合算し、
              金額・期日が未確定のカードは表示しません。
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
      {(withdrawalAccount.status === "ambiguous" || withdrawalAccount.status === "none") &&
        unresolvedCardCount > 0 && (
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
              引き落とし口座を特定できないカードが {unresolvedCardCount} 件あります。
            </p>
          </CardContent>
        </Card>
      )}
      <AccountListClient groupedAccounts={groupedAccounts} />
    </PageLayout>
  );
}

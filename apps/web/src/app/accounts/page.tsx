import { getAccountsGroupedByCategory } from "@asset-scraping/db";
import type { Metadata } from "next";
import { PageLayout } from "../../components/layout/page-layout";
import { Badge } from "../../components/ui/badge";
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

  return (
    <PageLayout
      title="連携サービス一覧"
      options={
        <>
          <Badge variant="success">正常: {okCount}件</Badge>
          <Badge variant="destructive">エラー: {errorCount}件</Badge>
        </>
      }
    >
      <AccountListClient groupedAccounts={groupedAccounts} />
    </PageLayout>
  );
}

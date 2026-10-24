import { getAccountsGroupedByCategory } from "@asset-scraping/db";
import type { Metadata } from "next";
import { PageLayout } from "../../components/layout/page-layout";
import { RefreshButton } from "../../components/RefreshButton";
import { OtpForm } from "../../components/settings/otp-form.client";
import { SettingsForm } from "../../components/settings/settings-form.client";
import { Card, CardContent } from "../../components/ui/card";

export const metadata: Metadata = {
  title: "設定",
};

export default async function SettingsPage() {
  // F7: 引き落とし口座に選べるのは銀行系口座（カード自身の負債残高は判定に使わない）
  const withdrawalAccounts = (await getAccountsGroupedByCategory())
    .filter((group) => group.categoryName === "銀行")
    .flatMap((group) => group.accounts.map((a) => ({ id: a.id, name: a.name })));

  return (
    <PageLayout title="設定" options={<RefreshButton />}>
      <div className="space-y-6">
        <OtpForm />
        <Card>
          <CardContent className="pt-6">
            <SettingsForm withdrawalAccounts={withdrawalAccounts} />
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          手動更新ボタンはダッシュボードと共通の crawler 更新 API を呼び出します。定期更新時刻の変更は、次回のスケジューラ判定（約 30
          秒間隔）から反映されます。
        </p>
      </div>
    </PageLayout>
  );
}

import type { Metadata } from "next";
import { PageLayout } from "../../components/layout/page-layout";
import { RefreshButton } from "../../components/RefreshButton";
import { SettingsForm } from "../../components/settings/settings-form.client";
import { Card, CardContent } from "../../components/ui/card";

export const metadata: Metadata = {
  title: "設定",
};

export default function SettingsPage() {
  return (
    <PageLayout title="設定" options={<RefreshButton />}>
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <SettingsForm />
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

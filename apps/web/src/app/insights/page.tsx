import { getFinancialMetrics } from "@asset-scraping/db";
import { Lightbulb } from "lucide-react";
import { InsightsBalanceCard } from "../../components/info/insights-balance-card";
import { InsightsHealthScoreCard } from "../../components/info/insights-health-score-card";
import { InsightsInvestmentCard } from "../../components/info/insights-investment-card";
import { InsightsLiabilityCard } from "../../components/info/insights-liability-card";
import { InsightsSavingsCard } from "../../components/info/insights-savings-card";
import { InsightsSpendingCard } from "../../components/info/insights-spending-card";
import { PageLayout } from "../../components/layout/page-layout";
import { Card, CardContent } from "../../components/ui/card";

export const metadata = {
  title: "財務インサイト",
};

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const metrics = await getFinancialMetrics();

  if (!metrics) {
    return (
      <PageLayout title="財務インサイト">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Lightbulb className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>分析データがありません。</p>
            <p className="text-sm mt-2">Crawler を実行すると財務分析が利用できます。</p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="財務インサイト">
      <div className="grid gap-6 md:grid-cols-2">
        <InsightsSavingsCard metrics={metrics} />
        <InsightsHealthScoreCard metrics={metrics} />
        <InsightsBalanceCard metrics={metrics} />
        <InsightsSpendingCard metrics={metrics} />
        <InsightsInvestmentCard metrics={metrics} />
        <InsightsLiabilityCard metrics={metrics} />
      </div>
    </PageLayout>
  );
}

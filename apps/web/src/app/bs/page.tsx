import { hasInvestmentHoldings } from "@asset-scraping/db";
import { mfUrls } from "@/lib/mf-urls";
import type { Metadata } from "next";
import { AssetHistoryChart } from "../../components/info/asset-history-chart";
import { BalanceSheetChart } from "../../components/info/balance-sheet-chart";
import { HoldingsTable } from "../../components/info/holdings-table";
import { UnrealizedGainCard } from "../../components/info/unrealized-gain-card";
import { HoldingsFilterProvider } from "../../components/info/unrealized-gain-card.client";
import { PageLayout } from "../../components/layout/page-layout";

export const metadata: Metadata = {
  title: "資産",
};

export const dynamic = "force-dynamic";

export default async function BSPage() {
  const showUnrealizedGain = await hasInvestmentHoldings();

  return (
    <PageLayout title="資産" href={mfUrls.portfolio}>
      <BalanceSheetChart />
      <AssetHistoryChart />
      <HoldingsFilterProvider filterAvailable={showUnrealizedGain}>
        {showUnrealizedGain && <UnrealizedGainCard />}
        <HoldingsTable type="asset" enableSharedFilter />
      </HoldingsFilterProvider>
      <HoldingsTable type="liability" />
    </PageLayout>
  );
}

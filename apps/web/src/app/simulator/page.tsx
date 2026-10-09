import type { Metadata } from "next";
import { CompoundSimulator } from "@/components/charts/compound-simulator/compound-simulator";
import { PageLayout } from "@/components/layout/page-layout";

export const metadata: Metadata = {
  title: "シミュレーター",
};

export default function SimulatorPage() {
  // TODO(後続フェーズ): DB の投資信託残高から初期投資額を取得して defaultInitialAmount に渡す
  return (
    <PageLayout title="シミュレーター">
      <CompoundSimulator />
    </PageLayout>
  );
}

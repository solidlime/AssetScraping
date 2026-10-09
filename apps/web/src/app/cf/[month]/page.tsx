import { getMonthlySummaryByMonth } from "@asset-scraping/db";
import { mfUrls } from "@/lib/mf-urls";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryBreakdown } from "../../../components/info/category-breakdown/category-breakdown";
import { TransactionTable } from "../../../components/info/transaction-table/transaction-table";
import { MonthSelector } from "../../../components/layout/month-selector";
import { PageLayout } from "../../../components/layout/page-layout";
import { formatMonth } from "@/lib/format";
import { formatCashFlowPageTitle } from "./page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ month: string }>;
}): Promise<Metadata> {
  const { month } = await params;
  return {
    title: formatCashFlowPageTitle(month),
  };
}

export default async function CFMonthPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const summary = await getMonthlySummaryByMonth(month);

  if (!summary) {
    notFound();
  }

  return (
    <PageLayout
      title={`収支 - ${formatMonth(month)}`}
      href={mfUrls.cashFlow}
      options={<MonthSelector currentMonth={month} basePath="/cf" />}
    >
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <CategoryBreakdown month={month} type="income" />
        <CategoryBreakdown month={month} type="expense" />
      </div>

      <TransactionTable month={month} />
    </PageLayout>
  );
}

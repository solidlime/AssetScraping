import { getAccountByMfId, getTransactionsByAccountId } from "@asset-scraping/db";
import { ListOrdered } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateFilterProvider } from "../../../components/info/date-filter-context";
import { TransactionTableClient } from "../../../components/info/transaction-table/transaction-table.client";
import { PageLayout } from "../../../components/layout/page-layout";
import { AccountStatusBadge } from "../../../components/ui/account-status-badge";
import { Badge } from "../../../components/ui/badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { mfUrls } from "@/lib/mf-urls";

/** 本家デモの口座詳細ページと同じ 50 件/ページ */
const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mfId: string }>;
}): Promise<Metadata> {
  const { mfId } = await params;
  const account = await getAccountByMfId(mfId);
  return { title: account ? `${account.name} - 口座` : "口座" };
}

/** db 層の行を UI 型へ変換。type が null（振替由来）の行は "transfer" として扱う。 */
function toUiTransactions(rows: Awaited<ReturnType<typeof getTransactionsByAccountId>>) {
  return rows.map((t) => ({
    id: t.id,
    date: t.date,
    category: t.category,
    description: t.description,
    amount: t.amount,
    type: t.type ?? "transfer",
    isTransfer: t.isTransfer,
    isExcludedFromCalculation: t.isExcludedFromCalculation,
    accountName: t.accountName,
  }));
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ mfId: string }>;
}) {
  const { mfId } = await params;
  const account = await getAccountByMfId(mfId);

  if (!account) {
    notFound();
  }

  const transactions = await getTransactionsByAccountId(account.id);

  return (
    <PageLayout
      title={account.name}
      href={mfUrls.accountDetail(mfId)}
      options={
        <>
          <Badge variant="outline">{account.categoryName}</Badge>
          {account.type !== "手動" && <AccountStatusBadge status={account.status} />}
        </>
      }
    >
      {transactions.length === 0 ? (
        <EmptyState icon={ListOrdered} title="詳細一覧" />
      ) : (
        <DateFilterProvider>
          <TransactionTableClient
            transactions={toUiTransactions(transactions)}
            showYearSelector
            pageSize={PAGE_SIZE}
          />
        </DateFilterProvider>
      )}
    </PageLayout>
  );
}

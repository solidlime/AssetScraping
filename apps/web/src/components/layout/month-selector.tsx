import { getAvailableMonths } from "@asset-scraping/db";
import { MonthSelectorClient } from "./month-selector.client";

interface MonthSelectorProps {
  currentMonth: string;
  basePath: string;
}

export async function MonthSelector({ currentMonth, basePath }: MonthSelectorProps) {
  const availableMonths = (await getAvailableMonths()).map((m) => m.month);

  return (
    <MonthSelectorClient
      currentMonth={currentMonth}
      availableMonths={availableMonths}
      basePath={basePath}
    />
  );
}

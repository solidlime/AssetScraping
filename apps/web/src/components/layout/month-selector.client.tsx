"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMonth } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Select } from "../ui/select";

interface MonthSelectorProps {
  currentMonth: string;
  availableMonths: string[];
  basePath: string;
}

export function MonthSelectorClient({
  currentMonth,
  availableMonths,
  basePath,
}: MonthSelectorProps) {
  const router = useRouter();

  const currentIndex = availableMonths.indexOf(currentMonth);
  // availableMonths is sorted desc (newest first), so "prev" is index + 1, "next" is index - 1
  const prevMonth =
    currentIndex < availableMonths.length - 1 ? availableMonths[currentIndex + 1] : null;
  const nextMonth = currentIndex > 0 ? availableMonths[currentIndex - 1] : null;

  const options = availableMonths.map((month) => ({
    value: month,
    label: formatMonth(month),
  }));

  return (
    <div className="flex items-center gap-2">
      <Link
        href={(prevMonth ? `${basePath}/${prevMonth}/` : "#") as Route}
        className={cn(
          "p-2 rounded-lg border border-border transition-colors",
          prevMonth
            ? "hover:bg-accent text-foreground"
            : "text-muted-foreground/30 pointer-events-none",
        )}
        aria-disabled={!prevMonth}
        aria-label="前の月"
      >
        <ChevronLeft className="w-5 h-5" />
      </Link>
      <Select
        value={currentMonth}
        options={options}
        onChange={(value) => {
          router.push(`${basePath}/${value}/` as Route);
        }}
        className="w-40"
        aria-label="月を選択"
        textCenter
      />
      <Link
        href={(nextMonth ? `${basePath}/${nextMonth}/` : "#") as Route}
        className={cn(
          "p-2 rounded-lg border border-border transition-colors",
          nextMonth
            ? "hover:bg-accent text-foreground"
            : "text-muted-foreground/30 pointer-events-none",
        )}
        aria-disabled={!nextMonth}
        aria-label="次の月"
      >
        <ChevronRight className="w-5 h-5" />
      </Link>
    </div>
  );
}

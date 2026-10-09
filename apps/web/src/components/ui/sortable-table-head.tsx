import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "./table";

interface SortableTableHeadProps {
  column: string;
  label: string;
  currentSort: string;
  currentDirection: "asc" | "desc";
  onSort: (column: string) => void;
  className?: string;
}

export function SortableTableHead({
  column,
  label,
  currentSort,
  currentDirection,
  onSort,
  className,
}: SortableTableHeadProps) {
  const isActive = currentSort === column;

  return (
    <TableHead
      className={className}
      aria-sort={isActive ? (currentDirection === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <span>{label}</span>
        {isActive ? (
          currentDirection === "asc" ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )
        ) : (
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}

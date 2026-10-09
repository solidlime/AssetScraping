import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "./button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  scrollTargetRef?: RefObject<HTMLElement | null>;
}

export function Pagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  scrollTargetRef,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const handlePageChange = (newPage: number) => {
    onPageChange(newPage);
    requestAnimationFrame(() => {
      scrollTargetRef?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="flex items-center justify-between pt-4 border-t">
      <div className="text-xs sm:text-sm text-muted-foreground">
        {currentPage * pageSize + 1} - {Math.min((currentPage + 1) * pageSize, totalItems)} /{" "}
        {totalItems}
      </div>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handlePageChange(Math.max(0, currentPage - 1))}
          disabled={currentPage === 0}
          aria-label="前のページ"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handlePageChange(Math.min(totalPages - 1, currentPage + 1))}
          disabled={currentPage >= totalPages - 1}
          aria-label="次のページ"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

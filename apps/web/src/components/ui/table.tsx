import type { HTMLAttributes, Ref, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  ref?: Ref<HTMLTableElement>;
}

function Table({ className, ref, ...props }: TableProps) {
  return (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  ref?: Ref<HTMLTableSectionElement>;
}

function TableHeader({ className, ref, ...props }: TableHeaderProps) {
  return <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />;
}

interface TableBodyProps extends HTMLAttributes<HTMLTableSectionElement> {
  ref?: Ref<HTMLTableSectionElement>;
}

function TableBody({ className, ref, ...props }: TableBodyProps) {
  return <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  ref?: Ref<HTMLTableRowElement>;
}

function TableRow({ className, ref, ...props }: TableRowProps) {
  return (
    <tr
      ref={ref}
      className={cn("border-b transition-colors hover:bg-muted/50", className)}
      {...props}
    />
  );
}

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  ref?: Ref<HTMLTableCellElement>;
}

function TableHead({ className, ref, ...props }: TableHeadProps) {
  return (
    <th
      ref={ref}
      className={cn("h-10 px-2 text-left align-middle font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  ref?: Ref<HTMLTableCellElement>;
}

function TableCell({ className, ref, ...props }: TableCellProps) {
  return <td ref={ref} className={cn("p-2 align-middle", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };

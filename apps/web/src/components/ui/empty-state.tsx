import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  message?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  message = "データがありません",
  className,
}: EmptyStateProps) {
  const body = (
    <div className={cn("text-center py-8 text-muted-foreground", className)}>{message}</div>
  );

  if (icon && title) {
    return (
      <Card>
        <CardHeader>
          <CardTitle icon={icon}>{title}</CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    );
  }

  return body;
}

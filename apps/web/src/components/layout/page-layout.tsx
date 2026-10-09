interface PageLayoutProps {
  title: string;
  children: React.ReactNode;
}

/** 本家 mf-dashboard の PageLayout を単純化して移植（外部リンク・オプション部は未移植）。 */
export function PageLayout({ title, children }: PageLayoutProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="space-y-6">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

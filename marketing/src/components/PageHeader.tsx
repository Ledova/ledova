export function PageHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="mx-auto max-w-3xl px-5 pb-12 pt-14 md:px-8 lg:pb-16 lg:pt-24">
      <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.02em] text-ink sm:text-5xl lg:text-6xl">
        {title}
      </h1>
      {lead && <p className="mt-5 text-[17px] leading-relaxed text-ink-muted lg:text-xl">{lead}</p>}
    </header>
  );
}

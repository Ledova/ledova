import { useEffect, type ReactNode } from 'react';
import { PAGE_COLUMN } from '../styles';

export function PageHeader({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title.endsWith('Ledova') ? title : `${title} · Ledova`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <header className={`${PAGE_COLUMN} pb-12 pt-14 lg:pb-16 lg:pt-24`}>
      <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.02em] text-text-primary sm:text-5xl lg:text-6xl">
        {title}
      </h1>
      {lead && <p className="mt-5 text-[17px] leading-relaxed text-text-muted lg:text-xl">{lead}</p>}
      {children}
    </header>
  );
}

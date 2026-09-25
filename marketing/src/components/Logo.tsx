function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="26" height="26" rx="7" className="stroke-ink" strokeWidth="1.5" />
      <path d="M10 8v12h8" className="stroke-ledger" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-7 w-7" />
      <span className="font-display text-[26px] font-medium leading-none tracking-[-0.01em] text-ink">Ledova</span>
    </span>
  );
}

import { useId, useState, type CSSProperties } from 'react';
import { formatShareCount, sharePercentage, type ClassOwnershipHolders } from '@ledova/shared';

interface OwnershipHoldersProps {
  holders: ClassOwnershipHolders;
  name: string;
  symbol: string;
  color: string;
}

export function OwnershipHolders({ holders, name, symbol, color }: OwnershipHoldersProps) {
  const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const sharesWidth = Math.max(6, formatShareCount(holders.issuedSupply).length);
  return (
    <div className="min-w-0 text-sm" style={{ '--ownership-shares-width': `${sharesWidth}ch` } as CSSProperties}>
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_var(--ownership-shares-width)_5rem] items-center gap-4 px-3 pb-2 text-text-muted md:grid"
      >
        <span className="text-xs">Shareholder</span>
        <span className="flex justify-between text-xs tabular-nums">
          <span>0%</span>
          <span>100%</span>
        </span>
        <span className="text-right text-xs">Shares</span>
        <span className="min-w-0 break-words text-right text-xs">% of {symbol}</span>
      </div>
      <ul aria-label={`${name} shareholders`} className="divide-y divide-border-subtle">
        {holders.results.map((holder) => {
          const holderName = holder.name || 'Unnamed shareholder';
          const percentage = sharePercentage(holder.balance, holders.issuedSupply);
          const active = selected === holder.member;
          return (
            <li key={holder.member}>
              <button
                type="button"
                aria-label={`Highlight ${holderName}’s holding`}
                aria-describedby={`${id}-${holder.member}`}
                aria-pressed={active}
                className={`group grid min-h-11 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-tertiary focus-visible:bg-surface-tertiary motion-safe:transition-colors motion-safe:duration-150 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_var(--ownership-shares-width)_5rem] md:gap-x-4 ${active ? 'bg-surface-tertiary' : ''}`}
                onClick={() => setSelected(active ? null : holder.member)}
              >
                <span className="col-span-2 col-start-1 row-start-1 min-w-0 break-words font-medium text-text-primary md:col-span-1">
                  {holderName}
                </span>
                <span
                  aria-hidden="true"
                  className="col-span-2 col-start-1 row-start-3 block h-3 w-full overflow-hidden rounded-sm bg-surface md:col-span-1 md:col-start-2 md:row-start-1"
                >
                  <span
                    className={`block h-full group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity motion-safe:duration-150 ${active ? 'opacity-100' : 'opacity-80'}`}
                    style={{
                      width:
                        holders.issuedSupply === '0'
                          ? '0%'
                          : `${(Number(holder.balance) / Number(holders.issuedSupply)) * 100}%`,
                      backgroundColor: color,
                    }}
                  />
                </span>
                <span id={`${id}-${holder.member}`} className="contents">
                  <span className="col-start-1 row-start-2 min-w-0 break-all tabular-nums text-text-primary md:col-start-3 md:row-start-1 md:text-right">
                    {formatShareCount(holder.balance)}
                    <span className="md:sr-only"> shares </span>
                  </span>
                  <span className="col-start-2 row-start-2 text-right tabular-nums text-text-primary md:col-start-4 md:row-start-1">
                    {percentage}
                    <span className="sr-only"> of {symbol}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

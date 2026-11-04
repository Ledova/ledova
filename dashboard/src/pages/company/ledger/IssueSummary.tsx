import { useId, useState, type ReactNode } from 'react';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { formatShortDate, shareCount } from '@ledova/shared';
import { ICON_SM } from '@components/iconSizes';
import { Status, type Tone } from '@components/Ledger';

export function IssueSummary({
  name,
  kind,
  shares,
  amount,
  companyEventOn,
  status,
  children,
}: {
  name: string;
  kind: string;
  shares: string;
  amount?: string;
  companyEventOn?: string | null;
  status?: { tone: Tone; label: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const details = useId();
  const facts = useId();
  const count = shareCount(shares);
  const Caret = open ? CaretUpIcon : CaretDownIcon;
  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={details}
          aria-label={`${name}, ${count}. ${open ? 'Hide' : 'Show'} details and documents`}
          aria-describedby={facts}
          onClick={() => setOpen((shown) => !shown)}
          className="group flex min-h-11 w-full items-center gap-3 text-left text-sm"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3 font-medium text-text-primary">
              <span className="min-w-0 break-words group-hover:text-brand-light">{name}</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">{count}</span>
            </span>
            <span id={facts} className="flex items-baseline justify-between gap-3 text-xs text-text-muted">
              <span className="min-w-0 break-words">{`${kind} · ${formatShortDate(companyEventOn, 'Date not recorded')}`}</span>
              {amount && <span className="shrink-0 whitespace-nowrap tabular-nums">{amount}</span>}
            </span>
          </span>
          <Caret size={ICON_SM} aria-hidden="true" className="shrink-0 text-text-muted group-hover:text-brand-light" />
        </button>
        {status && (
          <p className="text-sm text-text-primary">
            <span className="sr-only">Status: </span>
            <Status tone={status.tone}>{status.label}</Status>
          </p>
        )}
      </div>
      <div id={details} hidden={!open} className="flex flex-col gap-3">
        {children}
      </div>
    </>
  );
}

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { CaretDownIcon } from '@phosphor-icons/react';
import { CompanyPicker } from '@components/CompanyPicker';
import { PageAction } from '@components/Page';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';

export function MemberOwnershipHeader({
  companyView,
  shared,
  onChangeView,
}: {
  companyView: boolean;
  shared: boolean;
  onChangeView: (company: boolean) => void;
}) {
  const { read, select } = useMemberWorkspace();
  const name = read.record!.company.name;
  const headingClass = 'break-words font-display text-xl tracking-[-0.01em] text-text-primary';
  return (
    <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:justify-between">
      {read.records.length > 1 ? (
        <Popover className="min-w-0 sm:flex-1">
          {({ close }) => (
            <>
              <h2 className={headingClass}>
                <PopoverButton
                  aria-label={`Change company (${name})`}
                  className="flex max-w-full items-start gap-2 text-left hover:text-brand-light"
                >
                  <span className="min-w-0 break-words">{name}</span>
                  <CaretDownIcon aria-hidden className="mt-1.5 h-4 w-4 shrink-0 text-text-muted" />
                </PopoverButton>
              </h2>
              <PopoverPanel
                focus
                anchor="bottom start"
                className="z-40 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface-raised p-4 shadow-lg [--anchor-gap:8px]"
              >
                <CompanyPicker
                  companies={read.records.map((record) => ({ uuid: record.uuid, name: record.company.name }))}
                  value={read.record!.uuid}
                  disabled={read.busy || read.refreshing || !!read.retry}
                  onChange={(uuid) => {
                    select(uuid);
                    close();
                  }}
                />
              </PopoverPanel>
            </>
          )}
        </Popover>
      ) : (
        <h2 className={`${headingClass} min-w-0 sm:flex-1`}>{name}</h2>
      )}
      {shared && (
        <div
          role="group"
          aria-label="Ownership view"
          className="flex max-w-full shrink-0 divide-x divide-border-subtle rounded-lg border border-border [&>button]:rounded-none [&>button]:border-0 [&>button]:px-3 [&>button:first-child]:rounded-l-lg [&>button:last-child]:rounded-r-lg [&>button[aria-pressed=true]]:bg-surface-tertiary"
        >
          <PageAction label="Your shares" pressed={!companyView} onClick={() => onChangeView(false)} />
          <PageAction label="Company ownership" pressed={companyView} onClick={() => onChangeView(true)} />
        </div>
      )}
    </div>
  );
}

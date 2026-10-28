import type { ReactNode, Ref } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { FunnelIcon } from '@phosphor-icons/react';
import { ICON_MD } from './iconSizes';

export function FilterPopover({
  ref,
  label = 'Filters',
  icon = <FunnelIcon size={ICON_MD} aria-hidden="true" />,
  active = false,
  resetKey,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  label?: string;
  icon?: ReactNode;
  active?: boolean;
  resetKey?: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <Popover key={resetKey} className="shrink-0">
      <PopoverButton
        ref={ref}
        aria-label={label}
        title={label}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors hover:bg-surface-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-mid ${active ? 'border-brand-mid text-brand-light' : 'border-border text-text-primary'}`}
      >
        {icon}
      </PopoverButton>
      <PopoverPanel
        anchor="bottom end"
        focus
        className="z-50 flex max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface-raised p-4 shadow-lg [--anchor-gap:8px] [--anchor-padding:16px]"
      >
        {({ close }) => <>{children(close)}</>}
      </PopoverPanel>
    </Popover>
  );
}

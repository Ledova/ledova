import { useEffect, useRef, type ReactNode } from 'react';
import { FormActions, PageAction } from '@components/Page';

export function PreparationSlot({
  label,
  open,
  available,
  disabled,
  hidden,
  onOpen,
  children,
}: {
  label: string;
  open: boolean;
  available: boolean;
  disabled: boolean;
  hidden?: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const action = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const was = useRef(open);
  useEffect(() => {
    if (open !== was.current) (open ? form.current : action.current)?.focus();
    was.current = open;
  }, [open]);
  if (open)
    return (
      <div ref={form} tabIndex={-1} hidden={hidden} className="focus:outline-none">
        {children}
      </div>
    );
  if (!available) return null;
  return (
    <FormActions>
      <PageAction ref={action} label={label} primary disabled={disabled} onClick={onOpen} />
    </FormActions>
  );
}

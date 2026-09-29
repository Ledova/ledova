import { useCallback, useMemo, useState } from 'react';

export function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const isOpen = useCallback((id: string) => open.has(id), [open]);
  const toggle = useCallback(
    (id: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const closeAll = useCallback(() => setOpen((current) => (current.size === 0 ? current : new Set())), []);
  return useMemo(() => ({ isOpen, toggle, closeAll }), [isOpen, toggle, closeAll]);
}

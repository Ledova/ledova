import { useState } from 'react';

export function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  return {
    isOpen: (id: string) => open.has(id),
    toggle: (id: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    closeAll: () => setOpen(new Set()),
  };
}

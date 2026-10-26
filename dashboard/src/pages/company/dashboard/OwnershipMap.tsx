import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CompanyOwnershipSummary } from '@ledova/shared';
import { useTheme } from '@hooks/useTheme';

export interface OwnershipMapProps {
  classes: CompanyOwnershipSummary['classes'];
  issuedSupply: string;
  onSelect: (uuid: string) => void;
}

export function OwnershipMap({ classes, issuedSupply, onSelect }: OwnershipMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onSelect);
  const [failed, setFailed] = useState(false);
  const theme = useTheme();
  useLayoutEffect(() => {
    callback.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const screen = window.matchMedia?.('(min-width: 768px)');
    if (!screen) return;
    let cancelled = false;
    let pending = false;
    let dispose: (() => void) | undefined;
    const load = () => {
      if (!screen.matches) {
        dispose?.();
        dispose = undefined;
        return;
      }
      if (pending || dispose) return;
      pending = true;
      void import('./ownershipChart')
        .then(({ renderOwnershipMap }) => {
          pending = false;
          if (cancelled || !screen.matches) return;
          dispose = renderOwnershipMap(target, { classes, issuedSupply, onSelect: (uuid) => callback.current(uuid) });
        })
        .catch(() => {
          pending = false;
          if (!cancelled) setFailed(true);
        });
    };
    screen.addEventListener('change', load);
    load();
    return () => {
      cancelled = true;
      screen.removeEventListener('change', load);
      dispose?.();
    };
  }, [classes, issuedSupply, theme]);
  return (
    <div className="hidden md:block">
      {failed ? (
        <p role="status" className="py-3 text-sm text-text-muted">
          The ownership map could not be displayed. Choose a class above to explore its shareholders.
        </p>
      ) : (
        <div ref={container} className="h-80 min-w-0 w-full" aria-hidden="true" />
      )}
    </div>
  );
}

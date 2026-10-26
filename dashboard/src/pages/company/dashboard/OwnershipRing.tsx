import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatShareCount, sharePercentage, type CompanyOwnershipSummary } from '@ledova/shared';
import { useTheme } from '@hooks/useTheme';
import type { OwnershipRingController } from './ownershipChart';

export interface OwnershipRingProps {
  classes: CompanyOwnershipSummary['classes'];
  issuedSupply: string;
  highlighted: string | null;
  onSelect: (uuid: string) => void;
  onHighlight: (uuid: string | null) => void;
}

export function OwnershipRing({ classes, issuedSupply, highlighted, onSelect, onHighlight }: OwnershipRingProps) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef({ onSelect, onHighlight });
  const controller = useRef<OwnershipRingController | null>(null);
  const highlight = useRef(highlighted);
  const [failed, setFailed] = useState(false);
  const theme = useTheme();
  useLayoutEffect(() => {
    callback.current = { onSelect, onHighlight };
  }, [onSelect, onHighlight]);
  useLayoutEffect(() => {
    highlight.current = highlighted;
    controller.current?.highlight(highlighted);
  }, [highlighted]);
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const screen = window.matchMedia?.('(min-width: 768px)');
    if (!screen) return;
    let cancelled = false;
    let pending = false;
    const dispose = () => {
      controller.current?.dispose();
      controller.current = null;
    };
    const load = () => {
      if (!screen.matches) {
        dispose();
        return;
      }
      if (pending || controller.current) return;
      pending = true;
      void import('./ownershipChart')
        .then(({ renderOwnershipRing }) => {
          pending = false;
          if (cancelled || !screen.matches) return;
          controller.current = renderOwnershipRing(target, {
            classes,
            issuedSupply,
            onSelect: (uuid) => callback.current.onSelect(uuid),
            onHighlight: (uuid) => callback.current.onHighlight(uuid),
          });
          controller.current.highlight(highlight.current);
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
      dispose();
    };
  }, [classes, issuedSupply, theme]);
  const current = classes.find((item) => item.uuid === highlighted && item.issuedSupply !== null);
  return (
    <div className="hidden min-w-0 md:block">
      {failed ? (
        <p role="status" className="py-3 text-sm text-text-muted">
          The ownership ring could not be displayed. Choose a class from the list to explore its shareholders.
        </p>
      ) : (
        <div className="relative mx-auto h-80 w-full max-w-sm" aria-hidden="true">
          <div ref={container} className="h-full w-full" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
            <div className="w-[48%] min-w-0 space-y-1">
              <p className="break-all text-2xl font-medium tabular-nums text-text-primary">
                {formatShareCount(current?.issuedSupply ?? issuedSupply)}
              </p>
              <p className="truncate text-sm text-text-muted" title={current?.symbol}>
                {current ? current.symbol : 'issued shares'}
              </p>
              {current && (
                <p className="text-sm tabular-nums text-text-muted">
                  {sharePercentage(current.issuedSupply!, issuedSupply)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

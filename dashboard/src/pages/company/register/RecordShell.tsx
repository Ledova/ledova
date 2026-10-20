import { useEffect, useRef, type ReactNode } from 'react';
import { apiErrorSentence } from '@ledova/shared';
import { Row, Status } from '@components/Ledger';
import { DOWNLOAD_FAILED, STAGE_TONES } from '@pages/company/shared/proposals';

export function RecordShell({
  children,
  hidden,
  className = 'flex flex-col gap-3 py-4',
  focusKey,
}: {
  children: ReactNode;
  hidden?: boolean;
  className?: string;
  focusKey?: string;
}) {
  const item = useRef<HTMLLIElement>(null);
  const focused = useRef('');
  useEffect(() => {
    if (!focusKey || hidden || focused.current === focusKey) return;
    focused.current = focusKey;
    item.current?.focus({ preventScroll: true });
    item.current?.scrollIntoView?.({ block: 'start' });
  }, [focusKey, hidden]);
  return (
    <li ref={item} hidden={hidden} tabIndex={focusKey ? -1 : undefined} className={className}>
      {children}
    </li>
  );
}

export function RecordStage({ stage, children }: { stage: string; children: ReactNode }) {
  return (
    <Row label="Stage">
      <Status tone={STAGE_TONES[stage] ?? 'waiting'}>{children}</Status>
    </Row>
  );
}

export function RecordDownloadFailure({ error, children }: { error?: unknown; children?: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-error-light">
      {children ?? apiErrorSentence(error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
    </p>
  );
}

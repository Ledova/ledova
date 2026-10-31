import { useEffect, useRef, type ReactNode } from 'react';
import { apiErrorSentence } from '@ledova/shared';
import { Outcome, Row, Status, Failure } from '@components/Ledger';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';
import { DOWNLOAD_FAILED, STAGE_TONES } from '@pages/company/shared/proposals';

export function RecordShell({
  children,
  hidden,
  focusKey,
  landed,
}: {
  children: ReactNode;
  hidden?: boolean;
  focusKey?: string;
  landed?: Landed;
}) {
  const key = focusKey ?? landed?.key;
  const item = useRef<HTMLLIElement>(null);
  const focused = useRef('');
  useEffect(() => {
    if (!key || hidden || focused.current === key) return;
    focused.current = key;
    item.current?.focus({ preventScroll: true });
    item.current?.scrollIntoView?.({ block: 'start' });
  }, [key, hidden]);
  return (
    <li ref={item} hidden={hidden} tabIndex={key ? -1 : undefined} className="flex flex-col gap-3 py-4">
      {landed?.outcome && <Outcome>{landed.outcome}</Outcome>}
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
  return <Failure>{children ?? apiErrorSentence(error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}</Failure>;
}

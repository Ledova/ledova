import { RecordShell, RecordDownloadFailure, RecordStage } from './RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_PARTICULARS_COPY,
  REGISTER_PARTICULARS_DECISIONS,
  formatDateTime,
  type RegisterParticularsChange,
  formatDate,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { type RegisterSteps } from '@pages/company/shared/proposals';
import { useParticularsRecordDownload } from './useRegisterRecordDownload';
import type { Landed } from '@pages/company/register/shared/registerPlace';

const COPY = REGISTER_PARTICULARS_COPY;

type Held = { name: string; residentialAddress: string; asAt: string };

function Particulars({ title, held }: { title: string; held: Held | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm text-text-muted">{title}</p>
      {held ? (
        <Rows>
          <Row label={COPY.NAME}>{held.name}</Row>
          <Row label={COPY.RESIDENTIAL_ADDRESS}>{held.residentialAddress}</Row>
          <Row label={COPY.AS_AT}>{formatDate(held.asAt)}</Row>
        </Rows>
      ) : (
        <p className="text-sm text-text-primary">{COPY.NO_CURRENT_PARTICULARS}</p>
      )}
    </div>
  );
}

export function ParticularsRecord({
  landed,
  change,
  member,
  steps,
  guard,
  onDecided,
  onRefused,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  change: RegisterParticularsChange;
  member: string;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useParticularsRecordDownload(change, check);
  const context = `change for ${member} prepared ${formatDateTime(change.createdAt)}`;
  return (
    <RecordShell hidden={!visible} landed={landed}>
      {visible && (
        <details open={change.status === 'submitted'} className="space-y-3">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">{`${member} · ${COPY.STAGES[change.stage] ?? change.stage}`}</summary>
          <Rows>
            <Row label={COPY.MEMBER}>{member}</Row>
            <RecordStage stage={change.stage}>{COPY.STAGES[change.stage] ?? change.stage}</RecordStage>
            {change.preparedByName !== null && <Row label="Prepared by">{change.preparedByName || 'Not provided'}</Row>}
            <Row label="Prepared on">{formatDateTime(change.createdAt)}</Row>
          </Rows>
          <Particulars title={COPY.PROPOSED_PARTICULARS} held={change} />
          <Rows>
            <Row label={COPY.REASON}>{change.reason}</Row>
            <DecisionTrail proposal={change} labels={COPY.DECISIONS} />
          </Rows>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <div className="flex flex-wrap gap-2">
            <PageAction
              label={COPY.DOWNLOAD}
              context={context}
              busy={download.isPending}
              busyLabel="Downloading…"
              onClick={() => download.mutate()}
            />
          </div>
          {download.isError && <RecordDownloadFailure error={download.error} />}
        </details>
      )}
      <RegisterDecisions
        family={REGISTER_PARTICULARS_DECISIONS}
        copy={COPY}
        noun="particulars change"
        proposal={change}
        steps={steps}
        guard={guard}
        newEffectGuard={check}
        visible={visible}
        onHeldChange={onHeldChange}
        context={context}
        onDecided={onDecided}
        onRefused={onRefused}
        note={(kind) => kind !== 'reject' && <p className="text-sm text-text-muted">{COPY.PRECEDENCE_NOTE}</p>}
      >
        {(preview) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Particulars title={COPY.CURRENT_PARTICULARS} held={preview.current} />
            <Particulars title={COPY.PROPOSED_PARTICULARS} held={preview} />
          </div>
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

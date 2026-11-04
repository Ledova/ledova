import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_PARTICULARS_COPY,
  STAGE_TONES,
  formatDateTime,
  type RegisterParticularsChange,
  formatDate,
  formatShortDate,
  particularsChanged,
  useParticularsRecordDownload,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from './DecisionTrail';
import { RecordSummary } from './RecordSummary';
import { BROWSER_FILES } from '@utils/saveFile';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

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
        <p className="text-sm text-text-primary">{COPY.NOT_RECORDED_BEFORE}</p>
      )}
    </div>
  );
}

export function ParticularsRecord({
  landed,
  change,
  member,
  guard,
  visible = true,
  collapsed = false,
  ruled = false,
}: {
  landed?: Landed;
  change: RegisterParticularsChange;
  member: string;
  guard: () => void;
  visible?: boolean;
  collapsed?: boolean;
  ruled?: boolean;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useParticularsRecordDownload(change, check, BROWSER_FILES);
  const edit = !change.supportingEvidence;
  return (
    <RecordShell hidden={!visible || collapsed} ruled={ruled} landed={landed}>
      {visible && (
        <RecordSummary
          name={member}
          facts={`${particularsChanged(change)} · ${formatShortDate(change.asAt)}`}
          status={
            change.stage === 'applied'
              ? undefined
              : { tone: STAGE_TONES[change.stage] ?? 'waiting', label: COPY.STAGES[change.stage] ?? change.stage }
          }
        >
          <Rows>
            <RecordStage stage={change.stage}>{COPY.STAGES[change.stage] ?? change.stage}</RecordStage>
            {change.providedBy === 'member' ? (
              <Row label="Changed by">{COPY.PROVIDED_BY_MEMBER}</Row>
            ) : (
              change.preparedByName !== null && (
                <Row label={edit ? 'Changed by' : 'Prepared by'}>{change.preparedByName || 'Not provided'}</Row>
              )
            )}
            <Row label={edit ? 'Changed on' : 'Prepared on'}>{formatDateTime(change.createdAt)}</Row>
          </Rows>
          {edit ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <Particulars title={COPY.BEFORE} held={change.previousParticulars} />
              <Particulars title={COPY.AFTER} held={change} />
            </div>
          ) : (
            <Particulars title={COPY.PROPOSED_PARTICULARS} held={change} />
          )}
          {(change.reason || !edit) && (
            <Rows>
              {change.reason && <Row label={COPY.REASON}>{change.reason}</Row>}
              {!edit && (
                <>
                  <Row label="Evidence">{COPY.PROVIDED_BY_COMPANY}</Row>
                  <DecisionTrail proposal={change} labels={COPY.DECISIONS} />
                </>
              )}
            </Rows>
          )}
          {!edit && (
            <div className="flex flex-wrap gap-2">
              <PageAction
                label={COPY.DOWNLOAD}
                context={`change for ${member} prepared ${formatDateTime(change.createdAt)}`}
                busy={download.isPending}
                busyLabel="Downloading…"
                onClick={() => download.mutate()}
              />
            </div>
          )}
          {download.isError && <RecordDownloadFailure error={download.error} />}
        </RecordSummary>
      )}
    </RecordShell>
  );
}

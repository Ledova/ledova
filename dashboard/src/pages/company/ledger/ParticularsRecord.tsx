import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import { REGISTER_PARTICULARS_COPY, formatDateTime, type RegisterParticularsChange, formatDate } from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { DecisionTrail } from './DecisionTrail';
import { useParticularsRecordDownload } from './useRegisterRecordDownload';
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
}: {
  landed?: Landed;
  change: RegisterParticularsChange;
  member: string;
  guard: () => void;
  visible?: boolean;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useParticularsRecordDownload(change, check);
  const edit = !change.supportingEvidence;
  return (
    <RecordShell hidden={!visible} landed={landed}>
      {visible && (
        <>
          <h3 className="font-medium text-text-primary">{member}</h3>
          <Rows>
            <RecordStage stage={change.stage}>{COPY.STAGES[change.stage] ?? change.stage}</RecordStage>
            {change.preparedByName !== null && (
              <Row label={edit ? 'Changed by' : 'Prepared by'}>{change.preparedByName || 'Not provided'}</Row>
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
            <FormActions>
              <PageAction
                label={COPY.DOWNLOAD}
                context={`change for ${member} prepared ${formatDateTime(change.createdAt)}`}
                busy={download.isPending}
                busyLabel="Downloading…"
                onClick={() => download.mutate()}
              />
            </FormActions>
          )}
          {download.isError && <RecordDownloadFailure error={download.error} />}
        </>
      )}
    </RecordShell>
  );
}

import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import { REGISTER_CORRECTION_COPY, REGISTER_CORRECTION_DECISIONS, formatDateTime, formatDate } from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { DecisionTrail } from './DecisionTrail';
import { RegisterChanges } from '@pages/company/ledger/shared/RegisterChanges';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { describeEntry, entryLabel, entryName, type RegisterSteps } from '@pages/company/shared/proposals';
import type { ClassCorrection } from '@pages/company/ledger/shared/useClassCorrections';
import { useCorrectionRecordDownload } from './useRegisterRecordDownload';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_CORRECTION_COPY;

export function CorrectionRecord({
  landed,
  correction: { proposal, entry },
  steps,
  guard,
  onDecided,
  onRefused,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  correction: ClassCorrection;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useCorrectionRecordDownload(proposal, check);
  const context = `correction of the ${entryLabel(entry)}`;
  const downloadAction = (
    <PageAction
      label={COPY.DOWNLOAD}
      context={context}
      busy={download.isPending}
      busyLabel="Downloading…"
      onClick={() => download.mutate()}
    />
  );
  return (
    <RecordShell hidden={!visible} landed={landed}>
      {visible && (
        <>
          <h4 className="text-sm font-medium text-text-primary">Correction of the {entryName(entry)}</h4>
          <Rows>
            <RecordStage stage={proposal.stage}>{COPY.STAGES[proposal.stage] ?? proposal.stage}</RecordStage>
            {proposal.preparedByName !== null && (
              <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>
            )}
            <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
            <Row label={COPY.EFFECTIVE_ON}>{formatDate(proposal.effectiveOn)}</Row>
            <Row label={COPY.ORIGINAL_CHANGES}>
              <span className="block">{describeEntry(entry)}</span>
              <RegisterChanges changes={entry.changes} />
            </Row>
            <Row label={COPY.COMPENSATING_CHANGES}>
              <RegisterChanges changes={proposal.changes} named={entry.changes} />
            </Row>
            <Row label={COPY.AUTHORITY}>{COPY.AUTHORITIES[proposal.authority] ?? proposal.authority}</Row>
            {proposal.approvingDirector && <Row label={COPY.APPROVING_DIRECTOR}>{proposal.approvingDirector}</Row>}
            <Row label={COPY.AUTHORITY_REFERENCE}>{proposal.authorityReference}</Row>
            <Row label={COPY.REASON}>{proposal.reason}</Row>
            <Row label="Evidence">
              {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
            </Row>
            <DecisionTrail proposal={proposal} labels={COPY.DECISIONS} />
          </Rows>
        </>
      )}
      <FormActions>
        {downloadAction}
        <RegisterDecisions
          family={REGISTER_CORRECTION_DECISIONS}
          copy={COPY}
          noun="correction"
          proposal={proposal}
          steps={steps}
          guard={guard}
          newEffectGuard={check}
          visible={visible}
          onHeldChange={onHeldChange}
          context={context}
          onDecided={onDecided}
          onRefused={onRefused}
          note={(kind) => kind === 'apply' && <p className="text-sm text-text-muted">{COPY.COMPENSATION_NOTE}</p>}
        >
          {(preview) => (
            <Rows>
              <Row label={COPY.EFFECTIVE_ON}>{formatDate(preview.effectiveOn)}</Row>
              <Row label={COPY.ORIGINAL_CHANGES}>
                <RegisterChanges changes={preview.originalChanges} named={entry.changes} />
              </Row>
              <Row label={COPY.COMPENSATING_CHANGES}>
                <RegisterChanges changes={preview.changes} named={entry.changes} />
              </Row>
            </Rows>
          )}
        </RegisterDecisions>
      </FormActions>
      {download.isError && <RecordDownloadFailure error={download.error} />}
    </RecordShell>
  );
}

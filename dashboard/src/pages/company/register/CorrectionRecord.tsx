import { useLayoutEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_CORRECTION_COPY,
  REGISTER_CORRECTION_DECISIONS,
  apiErrorSentence,
  downloadRegisterCorrectionFile,
  formatDateTime,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterChanges } from '@pages/company/register/shared/RegisterChanges';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import {
  DOWNLOAD_FAILED,
  STAGE_TONES,
  describeEntry,
  retainedName,
  type RegisterSteps,
} from '@pages/company/shared/proposals';
import { saveFile } from '@utils/saveFile';
import type { ClassCorrection } from '@pages/company/register/shared/useClassCorrections';

const COPY = REGISTER_CORRECTION_COPY;

export function CorrectionRecord({
  correction: { proposal, entry },
  steps,
  guard,
  onDecided,
  onRefused,
  visible = true,
  onHeldChange,
}: {
  correction: ClassCorrection;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const available = useRef(visible);
  useLayoutEffect(() => {
    available.current = visible;
  }, [visible]);
  const check = () => {
    guard();
    if (!available.current) throw new Error('Open the current register task before reading or deciding this record.');
  };
  const download = useMutation({
    mutationFn: async () => {
      check();
      const { data } = await downloadRegisterCorrectionFile(apiClient, proposal.uuid, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(data, retainedName(proposal.evidenceSnapshot, `register-correction-${proposal.uuid}`));
    },
  });
  const context = `correction of entry ${entry.sequence}`;
  return (
    <li hidden={!visible} className="flex flex-col gap-3 py-4">
      {visible && (
        <details open={proposal.status === 'submitted'} className="space-y-3">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">{`Correction of entry ${entry.sequence} · ${COPY.STAGES[proposal.stage] ?? proposal.stage}`}</summary>
          <Rows>
            <Row label="Stage">
              <Status tone={STAGE_TONES[proposal.stage] ?? 'waiting'}>
                {COPY.STAGES[proposal.stage] ?? proposal.stage}
              </Status>
            </Row>
            {proposal.preparedByName !== null && (
              <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>
            )}
            <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
            <Row label={COPY.EFFECTIVE_ON}>{proposal.effectiveOn}</Row>
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
            <DecisionTrail proposal={proposal} labels={COPY.DECISIONS} />
          </Rows>
          <p className="text-sm text-text-muted">
            {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
          </p>
          <div className="flex flex-wrap gap-2">
            <PageAction
              label={COPY.DOWNLOAD}
              context={context}
              disabled={download.isPending}
              onClick={() => download.mutate()}
            />
          </div>
          {download.isError && (
            <p role="alert" className="text-sm text-error-light">
              {apiErrorSentence(download.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
            </p>
          )}
        </details>
      )}
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
            <Row label="Register sequence">{preview.registerSequence}</Row>
            <Row label={COPY.EFFECTIVE_ON}>{preview.effectiveOn}</Row>
            <Row label={COPY.ORIGINAL_CHANGES}>
              <RegisterChanges changes={preview.originalChanges} named={entry.changes} />
            </Row>
            <Row label={COPY.COMPENSATING_CHANGES}>
              <RegisterChanges changes={preview.changes} named={entry.changes} />
            </Row>
          </Rows>
        )}
      </RegisterDecisions>
    </li>
  );
}

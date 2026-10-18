import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_GRANT_COPY as COPY,
  REGISTER_AWARD_COPY as AWARD_COPY,
  REGISTER_GRANT_DECISIONS,
  apiErrorSentence,
  downloadRegisterGrantFile,
  formatDateTime,
  type RegisterDecisionKind,
  type RegisterGrant,
  type RegisterGrantDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from './RegisterDecisions';
import { DOWNLOAD_FAILED, STAGE_TONES, retainedName, shareCount, type RegisterSteps } from './proposals';
import { saveFile } from '@utils/saveFile';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' } };

function GrantRows({ grant }: { grant: RegisterGrant | RegisterGrantDecisionPreview }) {
  return (
    <Rows>
      {grant.award && <Row label="Employee award">{grant.award}</Row>}
      {'awardPromisedShares' in grant && grant.award && (
        <>
          <Row label={AWARD_COPY.PROMISED}>{shareCount(grant.awardPromisedShares!)}</Row>
          <Row label={AWARD_COPY.VESTED}>{shareCount(grant.awardVestedShares!)}</Row>
          <Row label={AWARD_COPY.ISSUED}>{shareCount(grant.awardIssuedShares!)}</Row>
          <Row label={AWARD_COPY.AVAILABLE}>{shareCount(grant.awardAvailableShares!)}</Row>
        </>
      )}
      <Row label="Member">{grant.name}</Row>
      <Row label={COPY.RESIDENTIAL_ADDRESS}>{grant.residentialAddress}</Row>
      <Row label="Member record">{grant.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{shareCount(grant.shares)}</Row>
      <Row label={COPY.TERMS_ON}>{grant.termsOn}</Row>
      <Row label="Register entry date">{grant.effectiveOn || 'Recorded on application'}</Row>
      <Row label={COPY.DIRECTOR}>{grant.approvingDirector}</Row>
      <Row label={COPY.TERMS}>{grant.terms}</Row>
      <Row label="Recipient acceptance">
        {grant.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
      </Row>
    </Rows>
  );
}

export function GrantRecord({
  grant,
  steps,
  guard,
  onSettled,
  visible = true,
  onHeldChange,
  newEffectGuard,
}: {
  grant: RegisterGrant;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  newEffectGuard?: (kind: RegisterDecisionKind) => void;
}) {
  const download = useMutation({
    mutationFn: async (kind: 'authority' | 'terms' | 'acceptance') => {
      guard();
      const { data } = await downloadRegisterGrantFile(apiClient, grant.uuid, kind, { ledovaSubmissionGuard: guard });
      guard();
      const snapshot =
        kind === 'authority'
          ? grant.evidenceSnapshot
          : kind === 'terms'
            ? grant.termsSnapshot
            : grant.acceptanceSnapshot;
      saveFile(data, retainedName(snapshot, `${kind}-${grant.uuid}`));
    },
  });
  const context = `grant for ${grant.name} prepared ${formatDateTime(grant.createdAt)}`;
  const documents: ('authority' | 'terms' | 'acceptance')[] = grant.acceptanceEvidence
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  return (
    <li hidden={!visible} className="flex flex-col gap-3 py-4">
      {visible && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-medium">{grant.name}</h4>
              <p className="text-sm text-text-muted">{shareCount(grant.shares)} · Non-paid share issue</p>
            </div>
            <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>
              {grant.stage === 'applied' ? 'Shares issued' : (COPY.STAGES[grant.stage] ?? grant.stage)}
            </Status>
          </div>
          <p className="text-sm text-text-muted">
            {grant.stage === 'applied'
              ? 'These shares are issued ownership. An employee award and its vesting records remain separate.'
              : grant.stage === 'approved'
                ? 'Next: record the approved issue. Approval has not changed ownership.'
                : grant.stage === 'rejected'
                  ? 'This rejected instruction issued no shares.'
                  : 'Next: review and approve the exact share issue.'}
          </p>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">Issue details and documents</summary>
            <Rows>
              <Row label="Stage">
                <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>{COPY.STAGES[grant.stage] ?? grant.stage}</Status>
              </Row>
              <Row label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(grant.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Row>
              <Row label={COPY.REASON}>{grant.reason}</Row>
              <DecisionTrail proposal={grant} labels={DECISION_COPY.DECISIONS} />
              {!!grant.registerEntry && <Row label="Register entry">{grant.registerEntry}</Row>}
            </Rows>
            <GrantRows grant={grant} />
            <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
            <div className="flex flex-wrap gap-2">
              {documents.map((kind) => (
                <PageAction
                  key={kind}
                  label={`Download ${kind} document`}
                  context={context}
                  disabled={download.isPending}
                  onClick={() => download.mutate(kind)}
                />
              ))}
            </div>
            {download.isError && (
              <p role="alert" className="text-sm text-error-light">
                {apiErrorSentence(download.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
              </p>
            )}
            <Rows>
              <Row label="Issue record">{grant.uuid}</Row>
              <Row label="Member record ID">{grant.member}</Row>
            </Rows>
          </details>
        </>
      )}
      <RegisterDecisions
        family={REGISTER_GRANT_DECISIONS}
        copy={DECISION_COPY}
        noun="non-paid grant"
        proposal={grant}
        steps={grant.stage === 'submitted' ? { ...steps, apply: undefined } : steps}
        guard={guard}
        newEffectGuard={newEffectGuard}
        visible={visible}
        onHeldChange={onHeldChange}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
      >
        {(preview) => (
          <>
            <GrantRows grant={preview} />
            <p className="text-sm text-text-muted">{COPY.EFFECTIVE_NOTE}</p>
            <Rows>
              <Row label="Register sequence">{preview.registerSequence}</Row>
              <Row label="Member holding">
                {shareCount(preview.currentShares)} → {shareCount(preview.afterShares)}
              </Row>
              <Row label="Issued supply">
                {shareCount(preview.issuedSupply)} → {shareCount(preview.afterIssuedSupply)}
              </Row>
              <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
            </Rows>
          </>
        )}
      </RegisterDecisions>
    </li>
  );
}

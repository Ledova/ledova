import { RecordShell, RecordDownloadFailure, RecordStage } from './RecordShell';
import {
  REGISTER_GRANT_COPY as COPY,
  REGISTER_AWARD_COPY as AWARD_COPY,
  REGISTER_GRANT_DECISIONS,
  formatDateTime,
  type RegisterDecisionKind,
  type RegisterGrant,
  type RegisterGrantDecisionPreview,
  shareCount,
  formatDate,
  shortReference,
} from '@ledova/shared';
import { Row, Rows, Status, Disclosure } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES, type RegisterSteps } from '@pages/company/shared/proposals';
import { useGrantRecordDownload } from './useRegisterRecordDownload';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' } };

function GrantRows({ grant }: { grant: RegisterGrant | RegisterGrantDecisionPreview }) {
  return (
    <Rows>
      {grant.award && <Row label="Employee award">{shortReference(grant.award)}</Row>}
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
      <Row label={COPY.TERMS_ON}>{formatDate(grant.termsOn)}</Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(grant.companyEventOn, 'Not recorded')}</Row>
      {'registerEntry' in grant &&
        grant.registerEntry &&
        grant.effectiveOn &&
        grant.effectiveOn !== grant.companyEventOn && <Row label="Ledger date">{formatDate(grant.effectiveOn)}</Row>}
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
  focusKey,
}: {
  grant: RegisterGrant;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  newEffectGuard?: (kind: RegisterDecisionKind) => void;
  focusKey?: string;
}) {
  const download = useGrantRecordDownload(grant, guard);
  const context = `grant for ${grant.name} prepared ${formatDateTime(grant.createdAt)}`;
  const documents: ('authority' | 'terms' | 'acceptance')[] = grant.acceptanceEvidence
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  return (
    <RecordShell hidden={!visible} focusKey={focusKey}>
      {visible && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-medium">{grant.name}</h4>
              <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>
                {grant.stage === 'applied' ? 'Shares issued' : (COPY.STAGES[grant.stage] ?? grant.stage)}
              </Status>
            </div>
            <p className="text-sm text-text-muted">{shareCount(grant.shares)} · Non-paid share issue</p>
          </div>
          <p className="text-sm text-text-muted">
            {grant.stage === 'applied'
              ? 'These shares are issued ownership. An employee award and its vesting records remain separate.'
              : grant.stage === 'approved'
                ? 'Next: record the approved issue. Approval has not changed ownership.'
                : grant.stage === 'rejected'
                  ? 'This rejected instruction issued no shares.'
                  : 'Ready for approval. No shares issued.'}
          </p>
          <Disclosure summary="Details and documents">
            <Rows>
              <RecordStage stage={grant.stage}>{COPY.STAGES[grant.stage] ?? grant.stage}</RecordStage>
              <Row label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(grant.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Row>
              <Row label={COPY.REASON}>{grant.reason}</Row>
              <DecisionTrail proposal={grant} labels={DECISION_COPY.DECISIONS} />
              {!!grant.registerEntry && <Row label="Register entry">{shortReference(grant.registerEntry)}</Row>}
            </Rows>
            <GrantRows grant={grant} />
            <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
            <div className="flex flex-wrap gap-2">
              {documents.map((kind) => (
                <PageAction
                  key={kind}
                  label={`Download ${kind} document`}
                  busy={download.isPending && download.variables === kind}
                  busyLabel="Downloading…"
                  context={context}
                  disabled={download.isPending}
                  onClick={() => download.mutate(kind)}
                />
              ))}
            </div>
            {download.isError && <RecordDownloadFailure error={download.error} />}
            <Rows>
              <Row label="Issue record">{shortReference(grant.uuid)}</Row>
              <Row label="Member reference">{shortReference(grant.member)}</Row>
            </Rows>
          </Disclosure>
        </>
      )}
      <RegisterDecisions
        recordActions
        approveLabel="Review and approve"
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
    </RecordShell>
  );
}

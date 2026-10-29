import { useCallback } from 'react';
import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import {
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_DECISIONS,
  formatDateTime,
  type RegisterDecisionKind,
  type RegisterGrant,
  shareCount,
  formatDate,
} from '@ledova/shared';
import { Row, Rows, Status, ShowMore } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES, type RegisterSteps } from '@pages/company/shared/proposals';
import { useGrantRecordDownload } from './useRegisterRecordDownload';
import { IssueSummary } from './IssueSummary';
import { GrantReview } from './GrantReview';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' } };

function GrantRows({ grant }: { grant: RegisterGrant }) {
  return (
    <Rows>
      {grant.award && <Row label="Source">Employee award</Row>}
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
  classLabel,
  reviewTarget,
  onReviewChange,
}: {
  grant: RegisterGrant;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  newEffectGuard?: (kind: RegisterDecisionKind) => void;
  focusKey?: string;
  classLabel: string;
  reviewTarget: HTMLElement | null;
  onReviewChange: (uuid: string, open: boolean) => void;
}) {
  const download = useGrantRecordDownload(grant, guard);
  const context = `grant for ${grant.name} prepared ${formatDateTime(grant.createdAt)}`;
  const documents: ('authority' | 'terms' | 'acceptance')[] = grant.acceptanceEvidence
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  const reviewChanged = useCallback((open: boolean) => onReviewChange(grant.uuid, open), [grant.uuid, onReviewChange]);
  const documentsView = (
    <>
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
    </>
  );
  return (
    <RecordShell hidden={!visible} focusKey={focusKey}>
      {visible && (
        <>
          <IssueSummary
            name={grant.name}
            kind={grant.award ? 'Employee award' : 'Non-paid issue'}
            shares={grant.shares}
            companyEventOn={grant.companyEventOn}
            status={
              <>
                <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>
                  {grant.stage === 'applied' ? 'Shares issued' : (COPY.STAGES[grant.stage] ?? grant.stage)}
                </Status>
                {grant.stage !== 'applied' && <p className="text-text-muted">No shares issued</p>}
              </>
            }
          />
          <ShowMore show="Show details and documents" hide="Hide details and documents">
            <p className="text-sm text-text-muted">
              {grant.stage === 'applied'
                ? 'These shares are issued ownership. An employee award and its vesting records remain separate.'
                : grant.stage === 'approved'
                  ? 'Next: record the approved issue. Approval has not changed ownership.'
                  : grant.stage === 'rejected'
                    ? 'This rejected instruction issued no shares.'
                    : 'Ready for approval. No shares issued.'}
            </p>
            <Rows>
              <RecordStage stage={grant.stage}>{COPY.STAGES[grant.stage] ?? grant.stage}</RecordStage>
              <Row label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(grant.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Row>
              <Row label={COPY.REASON}>{grant.reason}</Row>
              <DecisionTrail proposal={grant} labels={DECISION_COPY.DECISIONS} />
            </Rows>
            <GrantRows grant={grant} />
            <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
            {documentsView}
          </ShowMore>
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
        pageReview={{
          target: reviewTarget,
          onChange: reviewChanged,
          title: 'Review share issue',
          labels: { approve: 'Approve', apply: 'Record issue', reject: 'Reject issue' },
        }}
      >
        {(preview, kind) => (
          <GrantReview
            preview={preview}
            proposal={grant}
            classLabel={classLabel}
            documents={documentsView}
            showOwnership={kind !== 'reject'}
            approving={kind === 'approve'}
          />
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

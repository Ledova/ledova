import { RecordShell, RecordDownloadFailure, RecordStage } from './RecordShell';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_ALLOTMENT_DECISIONS,
  formatDateTime,
  type RegisterDecisionKind,
  type RegisterAllotment,
  type RegisterAllotmentDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES, shareCount, type RegisterSteps } from '@pages/company/shared/proposals';
import { useAllotmentRecordDownload } from './useRegisterRecordDownload';
import { AllotmentOwnership } from './AllotmentOwnership';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' } };

function AllotmentRows({ allotment }: { allotment: RegisterAllotment | RegisterAllotmentDecisionPreview }) {
  return (
    <Rows>
      <Row label="Investor/member">{allotment.name}</Row>
      <Row label="Residential address">{allotment.residentialAddress}</Row>
      <Row label="Member record">{allotment.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{shareCount(allotment.shares)}</Row>
      <Row label={COPY.CONSIDERATION}>AUD {allotment.consideration}</Row>
      <Row label={COPY.AGREEMENT_REFERENCE}>{allotment.agreement.reference}</Row>
      <Row label={COPY.AGREEMENT_ON}>{allotment.agreement.agreedOn}</Row>
      <Row label={COPY.TERMS}>{allotment.agreement.terms}</Row>
      <Row label="Agreement recorded">
        {allotment.agreement.recordedBy} · {formatDateTime(allotment.agreement.recordedAt)}
      </Row>
      <Row label={COPY.RECEIVED_AMOUNT}>AUD {allotment.contribution.amount}</Row>
      <Row label={COPY.RECEIVED_ON}>{allotment.contribution.receivedOn}</Row>
      <Row label="Receipt attested">
        {allotment.contribution.recordedBy} · {formatDateTime(allotment.contribution.recordedAt)}
      </Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{allotment.companyEventOn || 'Not recorded'}</Row>
      {'registerEntry' in allotment &&
        allotment.registerEntry &&
        allotment.effectiveOn &&
        allotment.effectiveOn !== allotment.companyEventOn && <Row label="Ledger date">{allotment.effectiveOn}</Row>}
      <Row label={COPY.DIRECTOR}>{allotment.approvingDirector}</Row>
    </Rows>
  );
}

export function AllotmentRecord({
  allotment,
  steps,
  guard,
  onSettled,
  newEffectGuard,
  visible = true,
  onHeldChange,
}: {
  allotment: RegisterAllotment;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  newEffectGuard: (kind: RegisterDecisionKind) => void;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const download = useAllotmentRecordDownload(allotment, guard);
  const context = `allotment for ${allotment.name} prepared ${formatDateTime(allotment.createdAt)}`;
  const documents: ('authority' | 'agreement' | 'receipt')[] = ['authority', 'agreement', 'receipt'];
  const decisionSteps = allotment.stage === 'submitted' ? { ...steps, apply: undefined } : steps;
  return (
    <RecordShell hidden={!visible} className="flex flex-col gap-4 py-4">
      {visible && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-medium">{allotment.name}</h4>
              <p className="text-sm text-text-muted">
                {shareCount(allotment.shares)} · AUD {allotment.consideration}
              </p>
            </div>
            <Status tone={STAGE_TONES[allotment.stage] ?? 'waiting'}>
              {allotment.stage === 'applied' ? 'Shares issued' : (COPY.STAGES[allotment.stage] ?? allotment.stage)}
            </Status>
          </div>
          <p className="text-sm text-text-muted">
            {allotment.stage === 'applied'
              ? `${allotment.companyEventOn ? `Shares issued on ${allotment.companyEventOn}` : 'Shares issued; company issue date not recorded'}. The company remains responsible for any required ASIC notification and certificate execution and delivery. Generated certificates remain unsigned.`
              : allotment.stage === 'approved'
                ? 'Next: record the approved share issue. Approval has not changed ownership.'
                : allotment.stage === 'rejected'
                  ? 'No shares were issued by this rejected allotment. The agreement and company receipt remain recorded.'
                  : 'Next: review and approve the company instruction. This allotment has not issued any shares.'}
          </p>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">Record details and documents</summary>
            <Rows>
              <RecordStage stage={allotment.stage}>{COPY.STAGES[allotment.stage] ?? allotment.stage}</RecordStage>
              <Row label="Prepared by">{allotment.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(allotment.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{allotment.authorityReference}</Row>
              <Row label={COPY.REASON}>{allotment.reason}</Row>
              <DecisionTrail proposal={allotment} labels={DECISION_COPY.DECISIONS} />
              {!!allotment.registerEntry && <Row label="Register entry">{allotment.registerEntry}</Row>}
              <Row label="Allotment record">{allotment.uuid}</Row>
              <Row label="Member record ID">{allotment.member}</Row>
              <Row label="External agreement record">{allotment.agreement.uuid}</Row>
              <Row label="Company contribution record">{allotment.contribution.uuid}</Row>
              <Row label="Authority evidence SHA-256">{allotment.evidenceFingerprint}</Row>
              <Row label="Agreement evidence SHA-256">{allotment.agreement.evidenceFingerprint}</Row>
              <Row label="Receipt evidence SHA-256">{allotment.contribution.evidenceFingerprint}</Row>
            </Rows>
            <AllotmentRows allotment={allotment} />
            <p className="text-sm text-text-muted">{COPY.RECEIPT_NOTE}</p>
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
            {download.isError && <RecordDownloadFailure error={download.error} />}
          </details>
        </>
      )}
      <RegisterDecisions
        family={REGISTER_ALLOTMENT_DECISIONS}
        copy={DECISION_COPY}
        noun="external allotment"
        proposal={allotment}
        steps={decisionSteps}
        guard={guard}
        newEffectGuard={newEffectGuard}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
        visible={visible}
        onHeldChange={onHeldChange}
        note={(kind, preview) =>
          kind !== 'reject' && allotment.status === 'submitted' && !allotment.registerEntry ? (
            <AllotmentOwnership preview={preview} />
          ) : null
        }
      >
        {(preview) => (
          <>
            <AllotmentRows allotment={preview} />
            <p className="text-sm text-text-muted">{COPY.EFFECTIVE_NOTE}</p>
            <Rows>
              <Row label="Register sequence">{preview.registerSequence}</Row>
              <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
            </Rows>
          </>
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

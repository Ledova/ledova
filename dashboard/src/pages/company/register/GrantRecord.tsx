import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_DECISIONS,
  apiErrorSentence,
  downloadRegisterGrantFile,
  formatDateTime,
  type RegisterGrant,
  type RegisterGrantDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from './RegisterDecisions';
import { DOWNLOAD_FAILED, STAGE_TONES, retainedName, shareCount, type RegisterSteps } from './proposals';
import { saveFile } from './useCompanyRegister';

function GrantRows({ grant }: { grant: RegisterGrant | RegisterGrantDecisionPreview }) {
  return (
    <Rows>
      <Row label="Member">
        {grant.name} · {grant.member}
      </Row>
      <Row label={COPY.RESIDENTIAL_ADDRESS}>{grant.residentialAddress}</Row>
      <Row label="Member record">{grant.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{shareCount(grant.shares)}</Row>
      <Row label={COPY.EFFECTIVE_ON}>{grant.effectiveOn}</Row>
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
}: {
  grant: RegisterGrant;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
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
    <li className="flex flex-col gap-3 py-4">
      <Rows>
        <Row label="Stage">
          <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>{COPY.STAGES[grant.stage] ?? grant.stage}</Status>
        </Row>
        <Row label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(grant.createdAt)}</Row>
        <Row label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Row>
        <Row label={COPY.REASON}>{grant.reason}</Row>
        <DecisionTrail proposal={grant} labels={COPY.DECISIONS} />
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
      <RegisterDecisions
        family={REGISTER_GRANT_DECISIONS}
        copy={COPY}
        noun="non-paid grant"
        proposal={grant}
        steps={steps}
        guard={guard}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
      >
        {(preview) => (
          <>
            <GrantRows grant={preview} />
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

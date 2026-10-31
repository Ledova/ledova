import type { ReactNode } from 'react';
import { formatDate, shareCount, type RegisterGrant, type RegisterGrantDecisionPreview } from '@ledova/shared';
import { ShowMore, Row, Rows, Section, Fact } from '@components/Ledger';

export function GrantReview({
  preview,
  proposal,
  classLabel,
  documents,
  showOwnership = true,
  approving = false,
}: {
  preview: RegisterGrantDecisionPreview;
  proposal: Pick<RegisterGrant, 'authorityReference' | 'reason'>;
  classLabel: string;
  documents: ReactNode;
  showOwnership?: boolean;
  approving?: boolean;
}) {
  return (
    <>
      <Section title={preview.name}>
        <p className="text-sm text-text-muted">{classLabel}</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Shares" numeric>
            {shareCount(preview.shares)}
          </Fact>
          <Fact label="Company issue date" numeric>
            {formatDate(preview.companyEventOn, 'Not recorded')}
          </Fact>
        </dl>
      </Section>
      {showOwnership && (
        <Section title="Ownership impact">
          {approving && <p className="text-sm text-text-muted">Approval alone does not issue shares.</p>}
          <Rows>
            <Row label="Member holding">
              {shareCount(preview.currentShares)} → {shareCount(preview.afterShares)}
            </Row>
            <Row label="Issued shares">
              {shareCount(preview.issuedSupply)} → {shareCount(preview.afterIssuedSupply)}
            </Row>
          </Rows>
        </Section>
      )}
      <Section title="Company records">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-base font-medium">Agreement</h3>
            <Rows>
              <Row label="Agreement date">{formatDate(preview.termsOn, 'Not recorded')}</Row>
              <Row label="Recipient acceptance">
                {preview.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
              </Row>
              {preview.award && (
                <>
                  <Row label="Promised">{shareCount(preview.awardPromisedShares!)}</Row>
                  <Row label="Company-recorded vested">{shareCount(preview.awardVestedShares!)}</Row>
                  <Row label="Issued through grants">{shareCount(preview.awardIssuedShares!)}</Row>
                  <Row label="Vested and not yet issued">{shareCount(preview.awardAvailableShares!)}</Row>
                </>
              )}
            </Rows>
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-medium">Company authority</h3>
            <Rows>
              <Row label="Approving director">{preview.approvingDirector}</Row>
              <Row label="Authority reference">{proposal.authorityReference}</Row>
              <Row label="Reason">{proposal.reason}</Row>
            </Rows>
          </div>
        </div>
        <ShowMore show="Show details and documents" hide="Hide details and documents">
          <Rows>
            <Row label="Agreement terms">{preview.terms}</Row>
            <Row label="Residential address">{preview.residentialAddress}</Row>
            <Row label="Member record">{preview.newMember ? 'New member' : 'Existing member'}</Row>
            {preview.award && <Row label="Source">Employee award</Row>}
            {preview.effectiveOn && preview.effectiveOn !== preview.companyEventOn && (
              <Row label="Ledger date">{formatDate(preview.effectiveOn)}</Row>
            )}
            <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
          </Rows>
          {documents}
        </ShowMore>
      </Section>
    </>
  );
}

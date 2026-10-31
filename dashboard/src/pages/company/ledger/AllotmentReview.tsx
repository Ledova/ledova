import type { ReactNode } from 'react';
import {
  allotmentOwnershipImpact,
  formatDate,
  formatDateTime,
  formatMoney,
  formatShareCount,
  REGISTER_ALLOTMENT_COPY as COPY,
  shareCount,
  type RegisterAllotmentDecisionPreview,
} from '@ledova/shared';
import { ShowMore, Row, Rows, Section, Fact } from '@components/Ledger';
import { AllotmentOwnership } from './AllotmentOwnership';

export function AllotmentReview({
  preview,
  documents,
  showOwnership = true,
}: {
  preview: RegisterAllotmentDecisionPreview;
  documents: ReactNode;
  showOwnership?: boolean;
}) {
  const impact = allotmentOwnershipImpact(preview);
  return (
    <>
      <Section title={preview.name}>
        <p className="text-sm text-text-muted">
          {preview.className} ({preview.classCode})
        </p>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Shares" numeric>
            {shareCount(preview.shares)}
          </Fact>
          <Fact label="Consideration" numeric>
            {formatMoney(preview.consideration, preview.currency)}
          </Fact>
          {impact && (
            <Fact label={COPY.UNIT_PRICE} numeric>
              {impact.unitPrice}
            </Fact>
          )}
        </dl>
      </Section>
      {showOwnership && (
        <Section title="Ownership impact">
          {impact && (
            <Rows>
              <Row label="Issued shares">
                {formatShareCount(impact.beforeIssuedSupply)} → {formatShareCount(impact.afterIssuedSupply)}
              </Row>
            </Rows>
          )}
          <AllotmentOwnership preview={preview} />
        </Section>
      )}
      <Section title="Company records">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-base font-medium">Agreement and receipt</h3>
            <Rows>
              <Row label="Agreement reference">{preview.agreement.reference}</Row>
              <Row label="Agreement date">{formatDate(preview.agreement.agreedOn, 'Not recorded')}</Row>
              <Row label="Amount received">{formatMoney(preview.contribution.amount, preview.currency)}</Row>
              <Row label="Receipt date">{formatDate(preview.contribution.receivedOn, 'Not recorded')}</Row>
            </Rows>
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-medium">Company authority</h3>
            <Rows>
              <Row label="Company issue date">{formatDate(preview.companyEventOn, 'Not recorded')}</Row>
              <Row label="Approving director">{preview.approvingDirector}</Row>
              <Row label="Authority reference">{preview.authorityReference}</Row>
              <Row label="Reason">{preview.reason}</Row>
            </Rows>
          </div>
        </div>
        <ShowMore show="Show details and documents" hide="Hide details and documents">
          <Rows>
            <Row label="Agreement terms">{preview.agreement.terms}</Row>
            <Row label="Residential address">{preview.residentialAddress}</Row>
            <Row label="Member record">{preview.newMember ? 'New member' : 'Existing member'}</Row>
            <Row label="Agreement recorded">{formatDateTime(preview.agreement.recordedAt, 'Not recorded')}</Row>
            <Row label="Receipt attested">{formatDateTime(preview.contribution.recordedAt, 'Not recorded')}</Row>
            <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
          </Rows>
          {documents}
        </ShowMore>
      </Section>
    </>
  );
}

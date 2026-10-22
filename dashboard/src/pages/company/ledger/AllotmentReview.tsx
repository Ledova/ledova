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
import { Disclosure, Row, Rows, Section } from '@components/Ledger';
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
          <div>
            <dt className="text-sm text-text-muted">Shares</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{shareCount(preview.shares)}</dd>
          </div>
          <div>
            <dt className="text-sm text-text-muted">Consideration</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">
              {formatMoney(preview.consideration, preview.currency)}
            </dd>
          </div>
          {impact && (
            <div>
              <dt className="text-sm text-text-muted">{COPY.UNIT_PRICE}</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums">{impact.unitPrice}</dd>
            </div>
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
          <AllotmentOwnership preview={preview} heading={false} summary={false} />
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
        <Disclosure summary="Details and documents">
          <Rows>
            <Row label="Agreement terms">{preview.agreement.terms}</Row>
            <Row label="Residential address">{preview.residentialAddress}</Row>
            <Row label="Member record">{preview.newMember ? 'New member' : 'Existing member'}</Row>
            <Row label="Agreement recorded">{formatDateTime(preview.agreement.recordedAt, 'Not recorded')}</Row>
            <Row label="Receipt attested">{formatDateTime(preview.contribution.recordedAt, 'Not recorded')}</Row>
            <Row label="Register sequence">{preview.registerSequence}</Row>
            <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
          </Rows>
          {documents}
        </Disclosure>
      </Section>
    </>
  );
}

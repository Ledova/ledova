import type { ReactNode } from 'react';
import {
  formatDate,
  shareCount,
  shortReference,
  type RegisterTransfer,
  type RegisterTransferDecisionPreview,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { Details, Part } from './IssueReviews';

export function TransferReview({
  preview,
  documents,
  proposal,
  showOwnership = true,
}: {
  preview: RegisterTransferDecisionPreview;
  documents: ReactNode;
  proposal: Pick<RegisterTransfer, 'authorityReference' | 'reason'>;
  showOwnership?: boolean;
}) {
  const from = preview.fromName || shortReference(preview.fromMember);
  const to = preview.name || shortReference(preview.toMember);
  return (
    <>
      <Part title="Transfer summary">
        <Rows>
          <Row label="From">{from}</Row>
          <Row label="To">{to}</Row>
          <Row label="Shares">{shareCount(preview.shares)}</Row>
        </Rows>
      </Part>
      {showOwnership && (
        <Part title="Ownership impact">
          <Rows>
            <Row label={from}>
              {shareCount(preview.fromCurrentShares)} → {shareCount(preview.fromAfterShares)}
            </Row>
            <Row label={to}>
              {shareCount(preview.toCurrentShares)} → {shareCount(preview.toAfterShares)}
            </Row>
            <Row label="Issued shares">
              {shareCount(preview.issuedSupply)} → {shareCount(preview.afterIssuedSupply)}
            </Row>
          </Rows>
        </Part>
      )}
      <Part title="Transfer instrument">
        <Rows>
          <Row label="Signed on">{formatDate(preview.signedOn, 'Not recorded')}</Row>
          <Row label="Lodged with company">{formatDate(preview.lodgedOn, 'Not recorded')}</Row>
        </Rows>
      </Part>
      <Part title="Company authority">
        <Rows>
          <Row label="Company transfer date">{formatDate(preview.companyEventOn, 'Not recorded')}</Row>
          <Row label="Approving director">{preview.approvingDirector}</Row>
          <Row label="Authority reference">{proposal.authorityReference}</Row>
          <Row label="Reason">{proposal.reason}</Row>
        </Rows>
      </Part>
      <Details label={`Details and documents for the review of the transfer from ${from} to ${to}`}>
        <Rows>
          <Row label="Transfer terms">{preview.terms}</Row>
          <Row label="Transferor residential address">{preview.fromResidentialAddress}</Row>
          <Row label="Recipient residential address">{preview.residentialAddress}</Row>
          <Row label="Recipient particulars">
            {preview.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
          </Row>
          {!!preview.effectiveOn && preview.effectiveOn !== preview.companyEventOn && (
            <Row label="Ledger date">{formatDate(preview.effectiveOn)}</Row>
          )}
          <Row label="Register sequence">{preview.registerSequence}</Row>
          <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
        </Rows>
        {documents}
      </Details>
    </>
  );
}

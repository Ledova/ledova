import type { ReactNode } from 'react';
import {
  REGISTER_TRANSFER_COPY as COPY,
  formatDate,
  shareCount,
  type RegisterTransfer,
  type RegisterTransferDecisionPreview,
} from '@ledova/shared';
import { Disclosure, Row, Rows, Section } from '@components/Ledger';
import { Table } from '@components/List';

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
  const from = preview.fromName || COPY.NAME_NOT_RECORDED;
  const to = preview.name || COPY.NAME_NOT_RECORDED;
  return (
    <>
      <Section title="Transfer summary">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-sm text-text-muted">From</dt>
            <dd className="mt-1 break-words text-sm font-medium">{from}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-text-muted">To</dt>
            <dd className="mt-1 break-words text-sm font-medium">{to}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-text-muted">Shares</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{shareCount(preview.shares)}</dd>
          </div>
        </dl>
      </Section>
      {showOwnership && (
        <Section title="Ownership impact">
          <Table
            caption="Transfer ownership impact"
            columns={[
              { label: 'Shareholder' },
              { label: 'Before', align: 'right' },
              { label: 'After', align: 'right' },
            ]}
          >
            <tr>
              <th scope="row" className="px-4 py-3 text-left font-medium">
                {from}
              </th>
              <td className="px-4 py-3 text-right tabular-nums">{shareCount(preview.fromCurrentShares)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{shareCount(preview.fromAfterShares)}</td>
            </tr>
            <tr>
              <th scope="row" className="px-4 py-3 text-left font-medium">
                {to}
              </th>
              <td className="px-4 py-3 text-right tabular-nums">{shareCount(preview.toCurrentShares)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{shareCount(preview.toAfterShares)}</td>
            </tr>
            <tr>
              <th scope="row" className="px-4 py-3 text-left font-medium">
                Issued shares
              </th>
              <td className="px-4 py-3 text-right tabular-nums">{shareCount(preview.issuedSupply)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{shareCount(preview.afterIssuedSupply)}</td>
            </tr>
          </Table>
        </Section>
      )}
      <Section title="Company records">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-base font-medium">Transfer instrument</h3>
            <Rows>
              <Row label="Signed on">{formatDate(preview.signedOn, 'Not recorded')}</Row>
              <Row label="Lodged with company">{formatDate(preview.lodgedOn, 'Not recorded')}</Row>
            </Rows>
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-medium">Company authority</h3>
            <Rows>
              <Row label="Company transfer date">{formatDate(preview.companyEventOn, 'Not recorded')}</Row>
              <Row label="Approving director">{preview.approvingDirector}</Row>
              <Row label="Authority reference">{proposal.authorityReference}</Row>
              <Row label="Reason">{proposal.reason}</Row>
            </Rows>
          </div>
        </div>
        <Disclosure summary="Details and documents">
          <Rows>
            <Row label="Transfer terms">{preview.terms}</Row>
            <Row label="Transferor residential address">{preview.fromResidentialAddress}</Row>
            <Row label="Recipient residential address">{preview.residentialAddress}</Row>
            <Row label="Recipient particulars">
              {preview.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
            </Row>
            {preview.effectiveOn && preview.effectiveOn !== preview.companyEventOn && (
              <Row label="Ledger date">{formatDate(preview.effectiveOn)}</Row>
            )}
            <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
          </Rows>
          {documents}
        </Disclosure>
      </Section>
    </>
  );
}

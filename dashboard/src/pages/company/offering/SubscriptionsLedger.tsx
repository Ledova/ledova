import { useState } from 'react';
import {
  formatDate,
  formatMoney,
  formatShareCount,
  REGISTER_COPY,
  useOfferingSubscriptions,
  type OfferingListItem,
} from '@ledova/shared';
import { Rows, Row, Section, Status } from '@components/Ledger';
import { OfferingReadNotice } from './OfferingReadNotice';

export function SubscriptionsLedger({
  offerings,
  operatorName,
}: {
  offerings: OfferingListItem[];
  operatorName: string;
}) {
  const [selected, setSelected] = useState('');
  const offering = offerings.find((row) => row.uuid === selected) ?? offerings[0];
  const read = useOfferingSubscriptions(offering?.uuid);
  if (!offering) return null;
  return (
    <Section title={REGISTER_COPY.APPLICATIONS_TITLE}>
      <p className="text-sm text-text-muted">{REGISTER_COPY.APPLICATIONS_NOTE(operatorName)}</p>
      <label className="block text-sm">
        Offering
        <select
          className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
          value={offering.uuid}
          onChange={(event) => setSelected(event.target.value)}
        >
          {offerings.map((row) => (
            <option key={row.uuid} value={row.uuid}>
              {row.tokenName} · {row.statusDisplay} · {formatDate(row.createdAt)}
            </option>
          ))}
        </select>
      </label>
      {read.isError ? (
        <OfferingReadNotice
          read={{ error: read.error, isRefreshing: read.isFetching, refetch: read.refetch }}
          label={REGISTER_COPY.APPLICATIONS_TITLE}
        />
      ) : read.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading applications…
        </p>
      ) : read.data.length === 0 ? (
        <p className="text-sm text-text-muted">{REGISTER_COPY.APPLICATIONS_EMPTY}</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            {read.data.length} application{read.data.length === 1 ? '' : 's'}
          </p>
          <ul className="divide-y divide-border-subtle">
            {read.data.map((row) => (
              <li key={row.uuid} className="space-y-2 py-4">
                <p className="break-all text-sm font-medium text-text-primary">
                  {row.investorName || row.walletAddress}
                </p>
                <Rows>
                  <Row label="Status">
                    <Status
                      tone={
                        row.status === 'allotted'
                          ? 'done'
                          : row.status === 'withdrawn' || row.status === 'refunded' || row.status === 'rejected'
                            ? 'closed'
                            : 'waiting'
                      }
                    >
                      {row.statusDisplay}
                    </Status>
                  </Row>
                  <Row label="Requested shares">{formatShareCount(String(row.quantity))}</Row>
                  <Row label="Allotted shares">
                    {row.allottedQuantity === null ? '—' : formatShareCount(String(row.allottedQuantity))}
                  </Row>
                  <Row label="Due">{formatMoney(row.amountDue, offering.priceCurrency)}</Row>
                  <Row label="Received">
                    {row.amountReceived === null ? '—' : formatMoney(row.amountReceived, offering.priceCurrency)}
                  </Row>
                  <Row label="Payment method">{row.settlementRailDisplay}</Row>
                  {row.reference && (
                    <Row label="Reference">
                      <span className="break-all">{row.reference}</span>
                    </Row>
                  )}
                  {row.paymentDueAt && <Row label="Payment due">{formatDate(row.paymentDueAt)}</Row>}
                  {row.paymentConfirmedAt && <Row label="Payment confirmed">{formatDate(row.paymentConfirmedAt)}</Row>}
                  <Row label="Allotment">{row.allotmentState}</Row>
                </Rows>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

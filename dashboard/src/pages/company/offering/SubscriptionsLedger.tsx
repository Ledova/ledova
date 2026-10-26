import { SelectField } from '@components/SelectField';
import { companySubscriptionTone } from '@components/statusTones';
import { CompanyReadNotice } from '@components/CompanyState';
import {
  COMPANY_SUBSCRIPTION_STATUS_LABELS as STATUSES,
  formatDate,
  formatMoney,
  formatShareCount,
  REGISTER_COPY,
  type OfferingListItem,
  type SubscriptionStatus,
  shortReference,
} from '@ledova/shared';
import { Section, Status, Loading } from '@components/Ledger';
import { ListSearch, Pager, Table, type Noun } from '@components/List';
import { useFirstPageWhenGone, useListParams } from '@hooks/useListParams';
import { useCompanyOfferingSubscriptions } from './useOffering';
import type { CompanyActionRead } from '@components/CompanyState';

const NOUN: Noun = ['application', 'applications'];

const COLUMNS = [
  { label: 'Investor' },
  { label: 'Status' },
  { label: 'Requested shares', align: 'right' as const },
  { label: 'Amount', align: 'right' as const },
  { label: 'Allotment' },
];

export function SubscriptionsLedger({
  offerings,
  operatorName,
  companyUuid,
  companyRead,
}: {
  offerings: OfferingListItem[];
  operatorName: string;
  companyUuid: string;
  companyRead: CompanyActionRead;
}) {
  const list = useListParams(['offering', 'status']);
  const offering = offerings.find((row) => row.uuid === list.filters.offering) ?? offerings[0];
  const status = Object.prototype.hasOwnProperty.call(STATUSES, list.filters.status)
    ? (list.filters.status as SubscriptionStatus)
    : undefined;
  const read = useCompanyOfferingSubscriptions(offering?.uuid, companyUuid, companyRead, {
    search: list.search,
    status,
    page: list.page,
  });
  const gone = useFirstPageWhenGone(list, read.error);
  if (!offering) return null;
  const narrowed = !!list.search || !!status;
  const data = read.isSuccess ? read.data : undefined;
  const empty = data?.count === 0 && !narrowed && !read.isPlaceholderData;
  return (
    <Section title={REGISTER_COPY.APPLICATIONS_TITLE}>
      <p className="text-sm text-text-muted">{REGISTER_COPY.APPLICATIONS_NOTE(operatorName)}</p>
      <SelectField
        label="Offering"
        options={offerings.map((row) => ({
          value: row.uuid,
          label: `${row.tokenName} · ${row.statusDisplay} · ${formatDate(row.createdAt)}`,
          reference: shortReference(row.uuid),
        }))}
        value={offering.uuid}
        onChange={(value) => list.setFilter('offering', value)}
      />
      {((data && !empty) || narrowed || read.isError) && (
        <ListSearch
          label="Search applications"
          hint="Investor name, wallet address or payment reference"
          list={list}
          noun={NOUN}
          count={data && !read.isPlaceholderData ? data.count : undefined}
          filtered={!!status}
        >
          <SelectField
            label="Status"
            options={[
              { value: '', label: 'All statuses' },
              ...Object.entries(STATUSES).map(([value, label]) => ({ value, label })),
            ]}
            value={status ?? ''}
            onChange={(value) => list.setFilter('status', value)}
          />
        </ListSearch>
      )}
      {read.isError && !gone ? (
        <CompanyReadNotice
          read={{ error: read.error, isRefreshing: read.isFetching, refetch: read.refetch }}
          label={REGISTER_COPY.APPLICATIONS_TITLE}
        />
      ) : !data || gone || (read.isPlaceholderData && data.count === 0) ? (
        <Loading>Loading applications…</Loading>
      ) : empty ? (
        <p className="text-sm text-text-muted">{REGISTER_COPY.APPLICATIONS_EMPTY}</p>
      ) : (
        <>
          {data.results.length > 0 && (
            <div aria-busy={read.isPlaceholderData} className={read.isPlaceholderData ? 'opacity-60' : undefined}>
              <Table caption={`Applications to the ${offering.tokenName} offering`} columns={COLUMNS}>
                {data.results.map((row) => (
                  <tr key={row.uuid} className="align-top">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <p className="break-words font-medium text-text-primary">
                        {row.investorName || 'Name not recorded'}
                      </p>
                      <p title={row.walletAddress} className="mt-1 max-w-48 truncate font-mono text-xs text-text-muted">
                        {row.walletAddress}
                      </p>
                      {row.reference && (
                        <p className="mt-1 break-all text-xs text-text-muted">Reference {row.reference}</p>
                      )}
                    </th>
                    <td className="px-4 py-3">
                      <Status tone={companySubscriptionTone(row.status)}>
                        {STATUSES[row.status] ?? row.statusDisplay}
                      </Status>
                      <p className="mt-1 text-xs text-text-muted">
                        {row.settlementRailDisplay}
                        {row.paymentConfirmedAt
                          ? ` · paid ${formatDate(row.paymentConfirmedAt)}`
                          : row.paymentDueAt
                            ? ` · due ${formatDate(row.paymentDueAt)}`
                            : ''}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatShareCount(String(row.quantity))}
                      {row.allottedQuantity !== null && (
                        <p className="mt-1 text-xs text-text-muted">
                          {formatShareCount(String(row.allottedQuantity))} allotted
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatMoney(row.amountDue, offering.priceCurrency)}
                      {row.amountReceived !== null && (
                        <p className="mt-1 text-xs text-text-muted">
                          {formatMoney(row.amountReceived, offering.priceCurrency)} received
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">{row.allotmentState}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          <Pager label="Application pages" list={list} noun={NOUN} count={data.count} busy={read.isPlaceholderData} />
        </>
      )}
    </Section>
  );
}

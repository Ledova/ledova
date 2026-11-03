import { SelectField } from '@components/SelectField';
import { FilterPopover } from '@components/FilterPopover';
import {
  formatShareCount,
  needsIdentityReview,
  shareholderList,
  type TokenHoldersResponse,
  sharePercentage,
  type Person,
} from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { ListSearch, Pager, Table, type Noun } from '@components/List';
import { PageActions, PageLink } from '@components/Page';
import { useListParams } from '@hooks/useListParams';
import { shareholderPath } from '@pages/company/ledger/shared/shareholders';

const NOUN: Noun = ['person', 'people'];

export function CompanyShareholders({
  registers,
  company,
  visible,
  blocked = false,
  people = [],
}: {
  registers: TokenHoldersResponse[];
  company: string;
  visible: boolean;
  blocked?: boolean;
  people?: Person[];
}) {
  const list = useListParams(['class']);
  const { shareholders, classFilter, count, visibleClasses, shownShareholders, shownPeople, unresolved } =
    shareholderList(registers, people, { class: list.filters.class, search: list.search, page: list.page });
  const filters = visible && (shareholders.length > 0 || people.length > 0) && (
    <FilterPopover active={!!classFilter || !!list.search}>
      {(close) => (
        <>
          <ListSearch label="Search people" list={list} noun={NOUN} count={count} filtered={!!classFilter} />
          <SelectField
            label="Share class"
            options={[
              { value: '', label: 'All classes' },
              ...registers.map(({ token }) => ({
                value: token.uuid,
                label: `${token.name} · ${token.symbol}`,
              })),
            ]}
            value={classFilter}
            onChange={(value) => {
              close();
              list.setFilter('class', value);
            }}
          />
        </>
      )}
    </FilterPopover>
  );
  return (
    <Section title="Current shareholders">
      <PageActions>{filters}</PageActions>
      {registers.some(({ initialized }) => !initialized) && (
        <p role="status" className="text-sm text-text-muted">
          Unopened classes have no recorded holdings. This list includes only the opened registers.
        </p>
      )}
      {shareholders.length === 0 && people.length === 0 ? (
        <p className="text-sm text-text-muted">No current shareholders yet.</p>
      ) : (
        <>
          {count === 0 && (!!list.search || !!classFilter) && (
            <p role="status" className="text-sm text-text-muted">
              No people match these filters.
            </p>
          )}
          {unresolved > 0 && (
            <p role="status" className="text-sm text-text-muted">
              {unresolved} {unresolved === 1 ? 'shareholder needs' : 'shareholders need'} identity review. Open their
              details before relying on these records.
            </p>
          )}
          {shownShareholders.length > 0 && (
            <div className="hidden md:block">
              <Table
                caption="Company shareholders"
                columns={[
                  { label: 'Shareholder' },
                  ...visibleClasses.map(({ token }) => ({
                    label: token.symbol,
                    detail: `shares and percentage of ${token.name}`,
                    align: 'right' as const,
                  })),
                  { label: 'Details', align: 'right', hidden: true },
                ]}
              >
                {shownShareholders.map((member) => (
                  <tr key={member.member}>
                    <th scope="row" className="break-words px-4 py-3 text-left font-normal">
                      <p className="font-medium text-text-primary">{member.name}</p>
                      {member.holdings.some(needsIdentityReview) && (
                        <p className="mt-1 text-xs text-text-muted">Identity needs review</p>
                      )}
                    </th>
                    {visibleClasses.map((register) => {
                      const holding = member.holdings.find(
                        ({ register: held }) => held.token.uuid === register.token.uuid,
                      );
                      return (
                        <td
                          key={register.token.uuid}
                          className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-text-primary"
                        >
                          {!register.initialized ? (
                            <span className="text-xs text-text-muted">Not opened</span>
                          ) : holding ? (
                            <>
                              {formatShareCount(holding.holder.balance)}
                              <span className="mt-1 block text-xs text-text-muted">
                                {sharePercentage(holding.holder.balance, register.issuedSupply)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">No {register.token.symbol} holding</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <PageLink
                        to={shareholderPath(member.member, company)}
                        label="Details"
                        context={member.name}
                        disabled={blocked}
                      />
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          {shownShareholders.length > 0 && (
            <ul aria-label="Company shareholders" className="divide-y divide-border-subtle md:hidden">
              {shownShareholders.map((member) => {
                const details = (
                  <>
                    {visibleClasses.map((register) => {
                      const holding =
                        register.initialized &&
                        member.holdings.find(({ register: held }) => held.token.uuid === register.token.uuid);
                      return (
                        holding && (
                          <span key={register.token.uuid} className="mt-1 block tabular-nums text-text-muted">
                            {register.token.symbol} {formatShareCount(holding.holder.balance)} ·{' '}
                            {sharePercentage(holding.holder.balance, register.issuedSupply)}
                          </span>
                        )
                      );
                    })}
                    {member.holdings.some(needsIdentityReview) && (
                      <span className="mt-1 block text-xs text-text-muted">Identity needs review</span>
                    )}
                  </>
                );
                return (
                  <li key={member.member}>
                    {blocked ? (
                      <div className="py-3 text-sm">
                        <p className="break-words font-medium text-text-primary">{member.name}</p>
                        {details}
                      </div>
                    ) : (
                      <LinkRow to={shareholderPath(member.member, company)} label={member.name}>
                        {details}
                      </LinkRow>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {shareholders.length === 0 && <p className="text-sm text-text-muted">No current shareholders yet.</p>}
          {shownPeople.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-medium text-text-primary">People without shares</h3>
              <ul className="divide-y divide-border-subtle">
                {shownPeople.map((person) => (
                  <li key={person.member} className="flex flex-col gap-1 py-3">
                    <span className="break-words text-sm text-text-primary">{person.name}</span>
                    <span className="break-words text-sm text-text-muted">{person.residentialAddress}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Pager label="Shareholder pages" list={list} noun={['person', 'people']} count={count} />
        </>
      )}
    </Section>
  );
}

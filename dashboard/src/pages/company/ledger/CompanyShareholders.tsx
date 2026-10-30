import { SelectField } from '@components/SelectField';
import { FilterPopover } from '@components/FilterPopover';
import {
  HOLDER_TYPE_LABELS,
  formatShareCount,
  searchRows,
  type TokenHoldersResponse,
  sharePercentage,
  type Person,
} from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { ListSearch, Pager, Table, type Noun } from '@components/List';
import { PageAction, PageActions, PageLink } from '@components/Page';
import { PAGE_SIZE, useListParams } from '@hooks/useListParams';
import { shareholderPath } from '@pages/company/ledger/shared/shareholders';

type Holding = { register: TokenHoldersResponse; holder: TokenHoldersResponse['holders'][number] };
type Shareholder = { member: string; name: string; holdings: Holding[] };

const NOUN: Noun = ['person', 'people'];

function needsIdentityReview({ holder }: Pick<Holding, 'holder'>) {
  return holder.holderType === 'ambiguous' || holder.holderType === 'unidentified';
}

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
  const grouped = new Map<string, Shareholder>();
  for (const register of registers) {
    for (const holder of register.holders) {
      const existing = grouped.get(holder.member);
      const holding = { register, holder };
      if (existing) existing.holdings.push(holding);
      else
        grouped.set(holder.member, {
          member: holder.member,
          name: holder.name || HOLDER_TYPE_LABELS[holder.holderType],
          holdings: [holding],
        });
    }
  }
  const shareholders = [...grouped.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.member.localeCompare(right.member),
  );
  const classFilter = registers.some(({ token }) => token.uuid === list.filters.class) ? list.filters.class : '';
  const found = searchRows(
    classFilter
      ? shareholders.filter((member) => member.holdings.some(({ register }) => register.token.uuid === classFilter))
      : shareholders,
    (member) => [member.name, ...member.holdings.map(({ holder }) => holder.name ?? '')].join(' '),
    list.search,
  );
  const withoutShares = classFilter
    ? []
    : searchRows(
        people.filter((person) => person.onRegister === false && !person.hasAwards && !person.awardOnly),
        (person) => `${person.name} ${person.residentialAddress}`,
        list.search,
      );
  const count = found.length + withoutShares.length;
  const visibleClasses = classFilter ? registers.filter(({ token }) => token.uuid === classFilter) : registers;
  const page = Math.min(list.page, Math.max(1, Math.ceil(count / PAGE_SIZE)));
  const start = (page - 1) * PAGE_SIZE;
  const end = page * PAGE_SIZE;
  const shownShareholders = found.slice(start, end);
  const shownPeople = withoutShares.slice(Math.max(0, start - found.length), Math.max(0, end - found.length));
  const unresolved = shareholders.filter(({ holdings }) => holdings.some(needsIdentityReview)).length;
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
            <div className="hidden sm:block">
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
                      {blocked ? (
                        <PageAction label="Details" context={member.name} disabled onClick={() => undefined} />
                      ) : (
                        <PageLink to={shareholderPath(member.member, company)} label="Details" context={member.name} />
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          {shownShareholders.length > 0 && (
            <ul aria-label="Company shareholders" className="divide-y divide-border-subtle sm:hidden">
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

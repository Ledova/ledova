import { SelectField } from '@components/SelectField';
import {
  HOLDER_TYPE_LABELS,
  formatShareCount,
  searchRows,
  type TokenHoldersResponse,
  sharePercentage,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { ListSearch, Pager, Table, type Noun } from '@components/List';
import { PageAction, PageLink } from '@components/Page';
import { PAGE_SIZE, useListParams } from '@hooks/useListParams';
import { shareholderPath } from './shareholders';

type Holding = { register: TokenHoldersResponse; holder: TokenHoldersResponse['holders'][number] };
type Shareholder = { member: string; name: string; holdings: Holding[] };

const NOUN: Noun = ['shareholder', 'shareholders'];

function needsIdentityReview({ holder }: Pick<Holding, 'holder'>) {
  return holder.holderType === 'ambiguous' || holder.holderType === 'unidentified';
}

export function CompanyShareholders({
  registers,
  company,
  blocked = false,
}: {
  registers: TokenHoldersResponse[];
  company: string;
  blocked?: boolean;
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
  const visibleClasses = classFilter ? registers.filter(({ token }) => token.uuid === classFilter) : registers;
  const page = Math.min(list.page, Math.max(1, Math.ceil(found.length / PAGE_SIZE)));
  const unresolved = shareholders.filter(({ holdings }) => holdings.some(needsIdentityReview)).length;
  return (
    <Section title="Current shareholders">
      {registers.some(({ initialized }) => !initialized) && (
        <p role="status" className="text-sm text-text-muted">
          Unopened classes have no recorded holdings. This list includes only the opened registers.
        </p>
      )}
      {shareholders.length === 0 ? (
        <p className="text-sm text-text-muted">No current shareholders yet.</p>
      ) : (
        <>
          <ListSearch
            label="Search shareholders"
            hint="Shareholder name"
            list={list}
            noun={NOUN}
            count={found.length}
            filtered={!!classFilter}
          >
            <SelectField
              label="Share class"
              options={[
                { value: '', label: 'All classes' },
                ...registers.map(({ token }) => ({ value: token.uuid, label: `${token.name} · ${token.symbol}` })),
              ]}
              value={classFilter}
              onChange={(value) => list.setFilter('class', value)}
            />
          </ListSearch>
          {unresolved > 0 && (
            <p role="status" className="text-sm text-text-muted">
              {unresolved} {unresolved === 1 ? 'shareholder needs' : 'shareholders need'} identity review. Open their
              details before relying on these records.
            </p>
          )}
          {found.length > 0 && (
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
              {found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((member) => (
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
          )}
          <Pager label="Shareholder pages" list={list} noun={NOUN} count={found.length} />
        </>
      )}
    </Section>
  );
}

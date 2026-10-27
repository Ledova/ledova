import { useId, useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import { searchRows } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_BASE, LABEL } from '@components/fieldClass';
import type { OwnershipCompany } from '@hooks/useOwnershipCompanies';

export function OwnershipCompanies({
  companies,
  selected,
  onSelect,
}: {
  companies: OwnershipCompany[];
  selected: string;
  onSelect: (uuid: string) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const found = searchRows(companies, (row) => row.name, search.trim());
  return (
    <Section title="Your companies">
      <div>
        <label htmlFor={id} className={LABEL}>
          Search companies
        </label>
        <input
          id={id}
          type="search"
          value={search}
          maxLength={100}
          className={`${FIELD_BASE} mt-1`}
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(25);
          }}
        />
      </div>
      <ul aria-label="Your companies" className="divide-y divide-border-subtle">
        {found.slice(0, limit).map((company) => (
          <li key={company.uuid}>
            <button
              type="button"
              aria-pressed={company.uuid === selected}
              onClick={() => onSelect(company.uuid)}
              className={`group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-sm hover:bg-surface-tertiary focus-visible:bg-surface-tertiary ${company.uuid === selected ? 'bg-surface-tertiary' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium text-text-primary">{company.name}</span>
                <span className="mt-1 block text-xs text-text-muted">
                  {[
                    company.canManage ? 'Company administrator' : company.canReadRegister ? 'Company access' : null,
                    company.memberUuids.length ? 'Member' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <CaretRightIcon aria-hidden className="h-4 w-4 shrink-0 text-text-muted" />
            </button>
          </li>
        ))}
      </ul>
      {found.length === 0 && <p className="text-sm text-text-muted">No companies match your search.</p>}
      {found.length > limit && <PageAction label="Show more companies" onClick={() => setLimit(limit + 25)} />}
    </Section>
  );
}

import { FIELD_CLASS } from '@components/fieldClass';
import type { useCompany } from './hooks/useCompany';

export function CompanySelection({ read }: { read: ReturnType<typeof useCompany> }) {
  if (read.companies.length < 2 && read.companyUuid) return null;
  return (
    <label className="block space-y-1 text-sm text-text-primary">
      Company
      <select
        className={FIELD_CLASS}
        value={read.companyUuid ?? ''}
        disabled={read.selectionBlocked}
        onChange={(event) => read.selectCompany(event.target.value)}
      >
        <option value="">Select a company</option>
        {read.companies.map((company) => (
          <option key={company.uuid} value={company.uuid}>
            {company.name}
          </option>
        ))}
      </select>
    </label>
  );
}

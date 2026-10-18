import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import type { useCompany } from './useCompany';

type Selection = Pick<ReturnType<typeof useCompany>, 'companyUuid' | 'selectionBlocked' | 'selectCompany'> & {
  companies: { uuid: string; name: string }[];
};

export function CompanySelection({ read }: { read: Selection }) {
  if (read.companies.length < 2 && read.companyUuid) return null;
  return (
    <label className={LABEL}>
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

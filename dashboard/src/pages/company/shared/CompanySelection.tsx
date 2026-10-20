import type { useCompanySelection } from '@ledova/shared';
import { SearchSelect } from '@components/SearchSelect';

type Selection = Pick<ReturnType<typeof useCompanySelection>, 'companyUuid' | 'selectionBlocked' | 'selectCompany'> & {
  companies: { uuid: string; name: string }[];
};

const COMPANIES = ['company', 'companies'] as const;

export function CompanyPicker({
  companies,
  value,
  onChange,
  disabled = false,
}: {
  companies: { uuid: string; name: string; detail?: string }[];
  value: string;
  onChange: (uuid: string) => void;
  disabled?: boolean;
}) {
  return (
    <SearchSelect
      label="Company"
      choices={companies.map(({ uuid, name, detail }) => ({ value: uuid, label: name, detail }))}
      value={value}
      onChange={onChange}
      placeholder="Type a company name"
      disabled={disabled}
      noun={COMPANIES}
    />
  );
}

export function CompanySelection({ read }: { read: Selection }) {
  if (read.companies.length < 2 && read.companyUuid) return null;
  return (
    <CompanyPicker
      companies={read.companies}
      value={read.companyUuid ?? ''}
      onChange={read.selectCompany}
      disabled={read.selectionBlocked}
    />
  );
}

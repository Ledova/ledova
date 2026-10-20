import { SearchSelect } from '@components/SearchSelect';

const COMPANIES = ['company', 'companies'] as const;

export function CompanyPicker({
  label = 'Company',
  companies,
  value,
  onChange,
  disabled = false,
}: {
  label?: string;
  companies: { uuid: string; name: string; detail?: string }[];
  value: string;
  onChange: (uuid: string) => void;
  disabled?: boolean;
}) {
  return (
    <SearchSelect
      label={label}
      choices={companies.map(({ uuid, name, detail }) => ({ value: uuid, label: name, detail }))}
      value={value}
      onChange={onChange}
      placeholder="Type a company name"
      disabled={disabled}
      noun={COMPANIES}
    />
  );
}

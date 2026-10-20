import type { useCompanySelection } from '@ledova/shared';
import { CompanyPicker } from '@components/CompanyPicker';

type Selection = Pick<ReturnType<typeof useCompanySelection>, 'companyUuid' | 'selectionBlocked' | 'selectCompany'> & {
  companies: { uuid: string; name: string }[];
};

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

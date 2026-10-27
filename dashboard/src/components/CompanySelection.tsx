import type { useCompanySelection } from '@ledova/shared';
import { CompanyPicker } from '@components/CompanyPicker';
import { useCompanyContext } from '@hooks/useCompanyContext';

type Selection = Pick<ReturnType<typeof useCompanySelection>, 'companyUuid' | 'selectionBlocked' | 'selectCompany'> & {
  companies: { uuid: string; name: string }[];
};

export function CompanySelection({ read }: { read: Selection }) {
  const context = useCompanyContext();
  if (read.companies.length < 2 && read.companyUuid) return null;
  return (
    <CompanyPicker
      companies={read.companies}
      value={read.companyUuid ?? ''}
      onChange={(uuid) => {
        if (!context || context.selectCompany(uuid, true)) read.selectCompany(uuid);
      }}
      disabled={read.selectionBlocked}
    />
  );
}

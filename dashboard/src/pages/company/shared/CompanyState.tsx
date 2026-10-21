import { COMPANY_STATUS_TONES } from './statusTones';
import type { CompanyStatus, useCompanySelection } from '@ledova/shared';
import { Status, LoadError } from '@components/Ledger';

type CompanyRead = Pick<ReturnType<typeof useCompanySelection>, 'error' | 'isRefreshing' | 'refetch'>;
export type CompanyActionRead = CompanyRead &
  Pick<
    ReturnType<typeof useCompanySelection>,
    'assertCurrent' | 'requestConfig' | 'companyKey' | 'scopeKey' | 'canAdmin' | 'ownerBusiness'
  >;

export function CompanyStatusMark({ status, label }: { status: CompanyStatus; label: string }) {
  const tone = COMPANY_STATUS_TONES.get(status) ?? 'closed';
  return <Status tone={tone}>{label}</Status>;
}

export function CompanyReadNotice({
  read,
  label = 'Company information',
}: {
  read: { error: unknown; isRefreshing: boolean; refetch: () => unknown };
  label?: string;
}) {
  if (read.error)
    return (
      <LoadError retry={read.refetch} busy={read.isRefreshing}>
        {label} could not be loaded.
      </LoadError>
    );
  return read.isRefreshing ? (
    <p role="status" className="text-sm text-text-muted">
      Refreshing {label.toLowerCase()}…
    </p>
  ) : null;
}

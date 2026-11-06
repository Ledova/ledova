import { COMPANY_STATUS_TONES, type CompanyStatus, type useCompanySelection } from '@ledova/shared';
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
}: {
  read: { error: unknown; isRefreshing: boolean; refetch: () => unknown };
}) {
  if (read.error)
    return (
      <LoadError retry={read.refetch} busy={read.isRefreshing}>
        Company information could not be loaded.
      </LoadError>
    );
  return read.isRefreshing ? (
    <p role="status" className="text-sm text-text-muted">
      Refreshing company information…
    </p>
  ) : null;
}

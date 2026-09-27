import { useQuery } from '@tanstack/react-query';
import { getCompanies, getCompany } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useCompany() {
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => getCompanies(apiClient),
  });
  const companyUuid = companies.data?.data.results[0]?.uuid;
  const detail = useQuery({
    queryKey: ['company', companyUuid],
    queryFn: () => getCompany(apiClient, companyUuid!).then(({ data }) => data),
    enabled: !!companyUuid && !companies.isError,
  });
  return {
    company: detail.data ?? null,
    companyUuid,
    isLoading: companies.isLoading || detail.isLoading,
    isRefreshing: companies.isFetching || detail.isFetching,
    error: companies.error || detail.error,
    refetch: () => Promise.all([companies.refetch(), ...(companyUuid ? [detail.refetch()] : [])]),
  };
}

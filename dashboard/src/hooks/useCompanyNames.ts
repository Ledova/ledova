import { isUuid } from '@ledova/shared';
import { useCompanyContext } from './useCompanyContext';

export function useCompanyNames() {
  const companies = useCompanyContext()?.directory.companies ?? [];
  return (uuid: string) =>
    isUuid(uuid) ? companies.find((company) => company.uuid === uuid.toLowerCase())?.name : undefined;
}

import { useCompanySelection } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useCompany(options: { ownedOnly?: boolean; personalOnly?: boolean } = {}) {
  return useCompanySelection(apiClient, options);
}

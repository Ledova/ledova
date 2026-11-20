import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteCompany } from '../services/companies';
import type { Company } from '../types';
import { createUserFriendlyError } from '../utils/errors';
import { useApiClient } from './useApiClient';
import { ownCompaniesKey, type useCompanySelection } from './useCompanySelection';
import { OWN_APPOINTMENTS_QUERY_KEY } from './useOwnAppointments';
import { REGISTER_QUERY_KEY } from './useCompanyOwnership';

export function useCompanyDeletion({
  company,
  read,
  onDeleted,
}: {
  company: Company;
  read: Pick<ReturnType<typeof useCompanySelection>, 'assertCurrent' | 'requestConfig' | 'companyKey' | 'owner'>;
  onDeleted: () => void;
}) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const [assertCurrent] = useState(() => read.assertCurrent);
  const [config] = useState(() => read.requestConfig(company.uuid));
  return useMutation({
    mutationFn: async () => {
      assertCurrent(company.uuid);
      const result = await deleteCompany(apiClient, company.uuid, config);
      if (result.status !== 204) throw createUserFriendlyError('The deletion could not be confirmed. Refresh first.');
    },
    onSuccess: async () => {
      onDeleted();
      await Promise.all([
        client.invalidateQueries({ queryKey: ownCompaniesKey(read.owner) }),
        client.invalidateQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY }),
        client.invalidateQueries({ queryKey: REGISTER_QUERY_KEY }),
        client.invalidateQueries({ queryKey: ['member-records'] }),
      ]);
      client.removeQueries({ queryKey: read.companyKey, exact: true });
    },
  });
}

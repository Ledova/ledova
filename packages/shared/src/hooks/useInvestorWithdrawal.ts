import { useMutation } from '@tanstack/react-query';
import { deleteInvestorClassification } from '../services/investorClassifications';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useSubmissionOwner';

export function useInvestorWithdrawal(refresh: () => Promise<unknown>, session?: OrderSubmissionSession) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (uuid: string) => deleteInvestorClassification(apiClient, uuid, session?.requestConfig()),
    onSuccess: refresh,
  });
}

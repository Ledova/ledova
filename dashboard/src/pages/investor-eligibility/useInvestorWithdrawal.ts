import { useMutation } from '@tanstack/react-query';
import { deleteInvestorClassification } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useInvestorWithdrawal(refresh: () => Promise<unknown>) {
  const withdraw = useMutation({
    mutationFn: (uuid: string) => deleteInvestorClassification(apiClient, uuid),
    onSuccess: refresh,
  });
  return withdraw;
}

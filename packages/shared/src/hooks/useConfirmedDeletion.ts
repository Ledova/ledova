import { useMutation } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { createUserFriendlyError } from '../utils/errors';
import { useApiClient } from './useApiClient';

export function useConfirmedDeletion<Target>(
  remove: (apiClient: AxiosInstance, target: Target) => Promise<{ status: number }>,
  onDeleted: () => Promise<unknown>,
) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: async (target: Target) => {
      const result = await remove(apiClient, target);
      if (result.status !== 204) throw createUserFriendlyError('The deletion could not be confirmed. Refresh first.');
    },
    onSuccess: () => onDeleted(),
  });
}

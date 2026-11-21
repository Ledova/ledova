import { useMutation } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { createUserFriendlyError, failureStatus } from '../utils/errors';
import { useApiClient } from './useApiClient';

const STALE = new Set([400, 404, 409]);

export function useConfirmedDeletion<Target>(
  remove: (apiClient: AxiosInstance, target: Target) => Promise<{ status: number }>,
  onDeleted: () => Promise<unknown>,
) {
  const apiClient = useApiClient();
  const refresh = async () => {
    try {
      await onDeleted();
    } catch {
      return;
    }
  };
  return useMutation({
    mutationFn: async (target: Target) => {
      const result = await remove(apiClient, target);
      if (result.status !== 204) throw createUserFriendlyError('The deletion could not be confirmed. Refresh first.');
    },
    onSuccess: refresh,
    onError: (failure) => {
      const status = failureStatus(failure);
      if (status !== undefined && STALE.has(status)) void refresh();
    },
  });
}

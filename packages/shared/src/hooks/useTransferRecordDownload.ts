import { useMutation } from '@tanstack/react-query';
import { downloadRegisterTransferFile } from '../services/register-transfers';
import type { RegisterTransfer } from '../types';
import { downloadedFile, retainedName, type FileDelivery } from '../utils/downloads';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useSubmissionOwner';

export function useTransferRecordDownload(
  transfer: RegisterTransfer,
  check: () => void,
  files: FileDelivery,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: async (kind: 'authority' | 'instrument') => {
      check();
      const response = await downloadRegisterTransferFile(apiClient, transfer.uuid, kind, {
        ...session?.requestConfig(),
        ...(files.responseType ? { responseType: files.responseType } : {}),
        ledovaSubmissionGuard: check,
      });
      check();
      const file = downloadedFile(response);
      if (!file) throw new Error('The retained document could not be read.');
      await files.save(
        file.data,
        retainedName(
          kind === 'authority' ? transfer.evidenceSnapshot : transfer.instrumentSnapshot,
          `${kind}-${transfer.uuid}`,
        ),
        file.type,
      );
    },
  });
}

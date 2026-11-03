import { useMutation } from '@tanstack/react-query';
import { downloadRegisterGrantFile } from '../services/register-grants';
import type { RegisterGrant } from '../types';
import { downloadedFile, retainedName, type FileDelivery } from '../utils/downloads';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useSubmissionOwner';

export function useGrantRecordDownload(
  grant: RegisterGrant,
  guard: () => void,
  files: FileDelivery,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: async (kind: 'authority' | 'terms' | 'acceptance') => {
      guard();
      const response = await downloadRegisterGrantFile(apiClient, grant.uuid, kind, {
        ...session?.requestConfig(),
        ...(files.responseType ? { responseType: files.responseType } : {}),
        ledovaSubmissionGuard: guard,
      });
      guard();
      const file = downloadedFile(response);
      if (!file) throw new Error('The retained document could not be read.');
      const snapshot =
        kind === 'authority'
          ? grant.evidenceSnapshot
          : kind === 'terms'
            ? grant.termsSnapshot
            : grant.acceptanceSnapshot;
      await files.save(file.data, retainedName(snapshot, `${kind}-${grant.uuid}`), file.type);
    },
  });
}

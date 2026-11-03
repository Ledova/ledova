import { useMutation } from '@tanstack/react-query';
import { downloadRegisterAllotmentFile } from '../services/register-allotments';
import type { RegisterAllotment } from '../types';
import { downloadedFile, retainedName, type FileDelivery } from '../utils/downloads';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useSubmissionOwner';

export function useAllotmentRecordDownload(
  allotment: RegisterAllotment,
  guard: () => void,
  files: FileDelivery,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: async (kind: 'authority' | 'agreement' | 'receipt') => {
      guard();
      const response = await downloadRegisterAllotmentFile(apiClient, allotment.uuid, kind, {
        ...session?.requestConfig(),
        ...(files.responseType ? { responseType: files.responseType } : {}),
        ledovaSubmissionGuard: guard,
      });
      guard();
      const file = downloadedFile(response);
      if (!file) throw new Error('The retained document could not be read.');
      const snapshot =
        kind === 'authority'
          ? allotment.evidenceSnapshot
          : kind === 'agreement'
            ? allotment.agreement.evidenceSnapshot
            : allotment.contribution.evidenceSnapshot;
      await files.save(file.data, retainedName(snapshot, `${kind}-${allotment.uuid}`), file.type);
    },
  });
}

import { useMutation } from '@tanstack/react-query';
import { downloadRegisterCorrectionFile } from '../services/register-corrections';
import { downloadRegisterImportFile } from '../services/register-imports';
import { downloadRegisterParticularsChangeFile } from '../services/register-particulars';
import type { RegisterCorrection, RegisterImport, RegisterParticularsChange } from '../types';
import { downloadedFile, retainedName, type FileDelivery } from '../utils/downloads';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useSubmissionOwner';

function fileConfig(check: () => void, files: FileDelivery, session?: OrderSubmissionSession) {
  return {
    ...session?.requestConfig(),
    ...(files.responseType ? { responseType: files.responseType } : {}),
    ledovaSubmissionGuard: check,
  };
}

function readable(response: { data?: unknown; headers?: unknown }) {
  const file = downloadedFile(response);
  if (!file) throw new Error('The retained document could not be read.');
  return file;
}

export function useCorrectionRecordDownload(
  proposal: RegisterCorrection,
  check: () => void,
  files: FileDelivery,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: async () => {
      check();
      const response = await downloadRegisterCorrectionFile(
        apiClient,
        proposal.uuid,
        fileConfig(check, files, session),
      );
      check();
      const file = readable(response);
      await files.save(
        file.data,
        retainedName(proposal.evidenceSnapshot, `register-correction-${proposal.uuid}`),
        file.type,
      );
    },
  });
}

export function useImportRecordDownload(
  proposal: RegisterImport,
  check: () => void,
  files: FileDelivery,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: async (copy: 'register' | 'asic') => {
      check();
      const response = await downloadRegisterImportFile(
        apiClient,
        proposal.uuid,
        copy,
        fileConfig(check, files, session),
      );
      check();
      const file = readable(response);
      await files.save(
        file.data,
        copy === 'asic'
          ? retainedName(proposal.asicSnapshot, `asic-extract-${proposal.uuid}`)
          : retainedName(proposal.evidenceSnapshot, `register-import-${proposal.uuid}`),
        file.type,
      );
    },
  });
}

export function useParticularsRecordDownload(
  change: RegisterParticularsChange,
  check: () => void,
  files: FileDelivery,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: async () => {
      check();
      const response = await downloadRegisterParticularsChangeFile(
        apiClient,
        change.uuid,
        fileConfig(check, files, session),
      );
      check();
      const file = readable(response);
      await files.save(
        file.data,
        retainedName(change.evidenceSnapshot, `particulars-change-${change.uuid}`),
        file.type,
      );
    },
  });
}

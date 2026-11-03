import { useMutation } from '@tanstack/react-query';
import {
  downloadRegisterCorrectionFile,
  downloadRegisterImportFile,
  downloadRegisterParticularsChangeFile,
  downloadRegisterTransferFile,
  type RegisterCorrection,
  type RegisterImport,
  type RegisterParticularsChange,
  type RegisterTransfer,
  retainedName,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';

export function useCorrectionRecordDownload(proposal: RegisterCorrection, check: () => void) {
  return useMutation({
    mutationFn: async () => {
      check();
      const { data } = await downloadRegisterCorrectionFile(apiClient, proposal.uuid, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(data, retainedName(proposal.evidenceSnapshot, `register-correction-${proposal.uuid}`));
    },
  });
}

export function useImportRecordDownload(proposal: RegisterImport, check: () => void) {
  return useMutation({
    mutationFn: async (copy: 'register' | 'asic') => {
      check();
      const { data } = await downloadRegisterImportFile(apiClient, proposal.uuid, copy, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(
        data,
        copy === 'asic'
          ? retainedName(proposal.asicSnapshot, `asic-extract-${proposal.uuid}`)
          : retainedName(proposal.evidenceSnapshot, `register-import-${proposal.uuid}`),
      );
    },
  });
}

export function useParticularsRecordDownload(change: RegisterParticularsChange, check: () => void) {
  return useMutation({
    mutationFn: async () => {
      check();
      const { data } = await downloadRegisterParticularsChangeFile(apiClient, change.uuid, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(data, retainedName(change.evidenceSnapshot, `particulars-change-${change.uuid}`));
    },
  });
}

export function useTransferRecordDownload(transfer: RegisterTransfer, check: () => void) {
  return useMutation({
    mutationFn: async (kind: 'authority' | 'instrument') => {
      check();
      const { data } = await downloadRegisterTransferFile(apiClient, transfer.uuid, kind, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(
        data,
        retainedName(
          kind === 'authority' ? transfer.evidenceSnapshot : transfer.instrumentSnapshot,
          `${kind}-${transfer.uuid}`,
        ),
      );
    },
  });
}

import { useMutation } from '@tanstack/react-query';
import {
  downloadRegisterAllotmentFile,
  downloadRegisterCorrectionFile,
  downloadRegisterGrantFile,
  downloadRegisterImportFile,
  downloadRegisterParticularsChangeFile,
  downloadRegisterTransferFile,
  type RegisterAllotment,
  type RegisterCorrection,
  type RegisterGrant,
  type RegisterImport,
  type RegisterParticularsChange,
  type RegisterTransfer,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { retainedName } from '@pages/company/shared/proposals';
import { saveFile } from '@utils/saveFile';

export function useAllotmentRecordDownload(allotment: RegisterAllotment, guard: () => void) {
  return useMutation({
    mutationFn: async (kind: 'authority' | 'agreement' | 'receipt') => {
      guard();
      const { data } = await downloadRegisterAllotmentFile(apiClient, allotment.uuid, kind, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      const snapshot =
        kind === 'authority'
          ? allotment.evidenceSnapshot
          : kind === 'agreement'
            ? allotment.agreement.evidenceSnapshot
            : allotment.contribution.evidenceSnapshot;
      saveFile(data, retainedName(snapshot, `${kind}-${allotment.uuid}`));
    },
  });
}

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

export function useGrantRecordDownload(grant: RegisterGrant, guard: () => void) {
  return useMutation({
    mutationFn: async (kind: 'authority' | 'terms' | 'acceptance') => {
      guard();
      const { data } = await downloadRegisterGrantFile(apiClient, grant.uuid, kind, { ledovaSubmissionGuard: guard });
      guard();
      const snapshot =
        kind === 'authority'
          ? grant.evidenceSnapshot
          : kind === 'terms'
            ? grant.termsSnapshot
            : grant.acceptanceSnapshot;
      saveFile(data, retainedName(snapshot, `${kind}-${grant.uuid}`));
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

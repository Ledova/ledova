import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  createUserFriendlyError,
  isRegisterEvidenceReceipt,
  REGISTER_IMPORT_COPY,
  uploadRegisterEvidence,
  type RegisterEvidence,
  type RegisterEvidenceKind,
  type RegisterEvidenceUpload,
} from '@ledova/shared';
import { useDocumentUpload } from '../../hooks/useDocumentUpload';
import { apiClient } from '../../services/apiClient';
import { uploadSize, type UploadFile } from '../../services/documentCopies';

export function useRegisterEvidence(company: string, kind: RegisterEvidenceKind) {
  const document = useDocumentUpload(company);
  const [receipt, setReceipt] = useState<RegisterEvidence | null>(null);
  const retry = useRef<{ file: UploadFile; appointment: string; key: string } | null>(null);
  const upload = async (appointment: string, guard: () => void) => {
    if (!document.file && receipt?.appointment === appointment) return receipt;
    let uploaded: RegisterEvidence | undefined;
    const completed = await document.submit(async ({ file, owner, sessionEpoch, assertCurrent }) => {
      const current = () => {
        guard();
        assertCurrent();
      };
      const key =
        retry.current?.file === file && retry.current.appointment === appointment
          ? retry.current.key
          : Crypto.randomUUID();
      retry.current = { file, appointment, key };
      const request = { companyId: owner, appointment, kind, idempotencyKey: key };
      const size = uploadSize(file);
      current();
      try {
        const response = await uploadRegisterEvidence(
          apiClient,
          { ...request, file: file as unknown as RegisterEvidenceUpload['file'] },
          { ledovaSessionEpoch: sessionEpoch, ledovaSubmissionGuard: current },
        );
        current();
        if (!isRegisterEvidenceReceipt(response.data, request, size)) {
          retry.current = null;
          throw createUserFriendlyError(REGISTER_IMPORT_COPY.UPLOAD_RECEIPT_FAILED);
        }
        uploaded = response.data;
      } catch (failure) {
        const status = (failure as { response?: { status?: number } })?.response?.status;
        if (status && status < 500) retry.current = null;
        throw failure;
      }
    });
    guard();
    if (!completed || !uploaded)
      throw createUserFriendlyError(`Choose the ${kind === 'asic_extract' ? 'ASIC extract' : 'share register'} again.`);
    retry.current = null;
    setReceipt(uploaded);
    return uploaded;
  };
  return {
    name: document.file?.name ?? receipt?.originalFilename ?? null,
    uploaded: !document.file && !!receipt,
    busy: document.isPicking || document.isSubmitting,
    pick: async () => {
      if (await document.pick()) setReceipt(null);
    },
    clear: () => {
      document.clear();
      setReceipt(null);
    },
    upload,
  };
}

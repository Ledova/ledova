import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createUserFriendlyError, uploadCompanyDocument, type DocumentType } from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { CompanyActionRead } from '@pages/company/shared/CompanyState';
import type { Problems } from '@hooks/useErrorSummary';

export function useCompanyDocumentUpload({
  companyUuid,
  documentType,
  canUpload,
  read,
  onClose,
  onSuccess,
}: {
  companyUuid: string;
  documentType: DocumentType;
  canUpload: boolean;
  read: CompanyActionRead;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [assertCurrent] = useState(() => read.assertCurrent);
  const guard = (uuid: string) => {
    if (!mounted.current) throw createUserFriendlyError('This upload is closed. Reopen it before continuing.');
    assertCurrent(uuid);
  };
  const [config] = useState(() => read.requestConfig(companyUuid));
  const available = canUpload && !read.error && !read.isRefreshing;
  const problems: Problems<'file'> = { file: !file && 'Choose the document file.' };
  const upload = useMutation({
    mutationFn: async () => {
      guard(companyUuid);
      const result = await uploadCompanyDocument(
        apiClient,
        companyUuid,
        { documentType, name: file!.name, file: file! },
        { ...config, ledovaSubmissionGuard: () => guard(companyUuid) },
      );
      guard(companyUuid);
      if (
        !result.data.uuid ||
        result.data.company !== companyUuid ||
        result.data.documentType !== documentType ||
        result.data.name !== file!.name ||
        !result.data.fileUrl
      )
        throw createUserFriendlyError(
          'The upload outcome could not be confirmed. Refresh the documents before retrying.',
        );
      return result;
    },
    onSuccess: async () => {
      guard(companyUuid);
      await onSuccess();
      guard(companyUuid);
      onClose();
    },
    onSettled: () => {
      pendingRef.current = false;
    },
  });
  return {
    setFile,
    pendingRef,
    upload,
    available,
    problems,
  };
}

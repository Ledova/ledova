import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  COMPANY_DOCUMENT_TYPES,
  apiErrorSentence,
  createUserFriendlyError,
  deleteCompanyDocument,
  type Company,
  type CompanyDocument,
  type DocumentType,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { CompanyActionRead } from '@components/CompanyState';

export function useCompanyDocuments({
  company,
  read,
  editable,
  refresh,
}: {
  company: Company;
  read: CompanyActionRead;
  editable: boolean;
  refresh: () => Promise<unknown>;
}) {
  const client = useQueryClient();
  const [upload, setUpload] = useState<{ type: DocumentType; label: string } | null>(null);
  const [removing, setRemoving] = useState<CompanyDocument | null>(null);
  const confirmationRef = useRef<CompanyDocument | null>(null);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      confirmationRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!read.error && !read.isRefreshing && !read.canAdmin) {
      confirmationRef.current = null;
    }
  }, [read.canAdmin, read.error, read.isRefreshing]);
  const [assertCurrent] = useState(() => read.assertCurrent);
  const [config] = useState(() => read.requestConfig(company.uuid));
  const guard = (uuid: string) => {
    if (!mounted.current) throw createUserFriendlyError('This company action is closed. Reopen it before continuing.');
    assertCurrent(uuid);
  };
  const documentGuard = (document: CompanyDocument) => {
    guard(company.uuid);
    const current = client
      .getQueryData<Company>(read.companyKey)
      ?.documents.find((item) => item.uuid === document.uuid);
    if (
      !current ||
      current.company !== company.uuid ||
      document.company !== company.uuid ||
      current.fileUrl !== document.fileUrl ||
      current.documentType !== document.documentType
    )
      throw createUserFriendlyError('The document changed. Refresh before continuing.');
  };
  const remove = useMutation({
    mutationFn: async (document: CompanyDocument) => {
      documentGuard(document);
      const result = await deleteCompanyDocument(apiClient, company.uuid, document.uuid, {
        ...config,
        ledovaSubmissionGuard: () => documentGuard(document),
      });
      guard(company.uuid);
      if (result.status !== 204)
        throw createUserFriendlyError('The deletion outcome could not be confirmed. Refresh before retrying.');
      return result;
    },
    onSuccess: async () => {
      guard(company.uuid);
      await refresh();
      guard(company.uuid);
      setRemoving(null);
    },
    onError: (_failure, document) => {
      try {
        guard(company.uuid);
        const next = { ...document };
        confirmationRef.current = next;
        setRemoving(next);
      } catch {
        confirmationRef.current = null;
      }
    },
    onSettled: () => {
      pendingRef.current = false;
    },
  });
  if (removing && !read.error && !read.isRefreshing && !read.canAdmin) setRemoving(null);
  const viewDocument = (document: CompanyDocument, event: MouseEvent<HTMLAnchorElement>) => {
    try {
      documentGuard(document);
    } catch (failure) {
      event.preventDefault();
      setError(apiErrorSentence(failure, 'The document could not be opened. Refresh before continuing.'));
    }
  };
  const removeDocument = (document: CompanyDocument) => {
    remove.reset();
    const next = { ...document };
    confirmationRef.current = next;
    setRemoving(next);
  };
  const ready = editable && !read.error && !read.isRefreshing && !remove.isPending;
  const documentTypes = COMPANY_DOCUMENT_TYPES.map((item) => ({
    ...item,
    documents: company.documents.filter((document) => document.documentType === item.type),
  }));
  const populatedTypes = documentTypes.filter((item) => item.documents.length > 0);
  const availableTypes = documentTypes.filter(
    (item) => item.type === upload?.type || item.type === 'other' || item.documents.length === 0,
  );
  const uploadChoice = availableTypes.find((item) => item.type === 'other');
  return {
    error,
    removing,
    confirmationRef,
    pendingRef,
    remove,
    ready,
    populatedTypes,
    availableTypes,
    uploadChoice,
    viewDocument,
    removeDocument,
    upload,
    setUpload,
    setRemoving,
  };
}

import {
  OFFERING_PUBLISHED_STATUSES,
  addOfferingDocuments,
  attachableDocuments,
  createUserFriendlyError,
  type Company,
} from '@ledova/shared';
import { type CompanyActionRead } from '@components/CompanyState';
import apiClient from '@services/apiClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { companyOfferingDetailKey, useCompanyOffering, type useOfferings } from './useOffering';

export function useOfferingDocumentsEditor({
  uuid,
  targetCompany,
  company,
  companyRead,
  data,
  onClose,
}: {
  uuid: string;
  targetCompany: string;
  company: Company | null;
  companyRead: CompanyActionRead;
  data: ReturnType<typeof useOfferings>;
  onClose: () => void;
}) {
  const detail = useCompanyOffering(uuid, targetCompany, companyRead);
  const client = useQueryClient();
  const mounted = useRef(true);
  const pendingRef = useRef(false);
  const [assertCurrent] = useState(() => companyRead.assertCurrent);
  const [config] = useState(() => companyRead.requestConfig(targetCompany, 'owner'));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const guard = () => {
    if (!mounted.current) throw createUserFriendlyError('This company action is closed.');
    assertCurrent(targetCompany, 'owner');
    data.assertOffering(uuid, 'documents');
    if (uuid) {
      const state = client.getQueryState<import('@ledova/shared').Offering>(
        companyOfferingDetailKey(targetCompany, companyRead.scopeKey, uuid),
      );
      if (
        state?.status !== 'success' ||
        state.fetchStatus !== 'idle' ||
        !state.data ||
        state.data.uuid !== uuid ||
        !OFFERING_PUBLISHED_STATUSES.includes(state.data.status)
      )
        throw createUserFriendlyError('Refresh the current offering before continuing.');
    }
  };
  const [chosen, setChosen] = useState<string[]>([]);
  const kept = detail.data?.documents ?? [];
  const documents = company?.uuid === targetCompany ? attachableDocuments(company.documents, kept) : [];
  const published = !!detail.data && OFFERING_PUBLISHED_STATUSES.includes(detail.data.status);
  const blocked =
    company?.uuid !== targetCompany ||
    !!companyRead.error ||
    companyRead.isRefreshing ||
    detail.isError ||
    detail.isFetching ||
    !published;
  const request = useMutation({
    mutationFn: async (added: string[]) => {
      guard();
      const current = client.getQueryData<Company>(companyRead.companyKey);
      if (
        !current ||
        added.some((id) => !attachableDocuments(current.documents, kept).some((document) => document.uuid === id))
      )
        throw createUserFriendlyError('These company documents changed. Refresh before continuing.');
      const result = await addOfferingDocuments(apiClient, uuid, added, { ...config, ledovaSubmissionGuard: guard });
      guard();
      return result;
    },
    onSettled: () => {
      pendingRef.current = false;
    },
    onSuccess: async () => {
      guard();
      await data.refresh();
      guard();
      onClose();
    },
  });
  const addable = chosen.filter((document) => !kept.includes(document));
  const refetch = async () => {
    const companyResult = companyRead.error ? await companyRead.refetch() : [];
    await data.refetch();
    await detail.refetch();
    return companyResult;
  };
  return { detail, pendingRef, chosen, setChosen, kept, documents, published, blocked, request, addable, refetch };
}

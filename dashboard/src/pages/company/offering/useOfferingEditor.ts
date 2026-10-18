import {
  createOffering,
  createUserFriendlyError,
  updateOffering,
  type Company,
  type OfferingInput,
} from '@ledova/shared';
import { type CompanyActionRead } from '@pages/company/shared/CompanyState';
import apiClient from '@services/apiClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { companyOfferingDetailKey, useCompanyOffering, type useOfferings } from './useOffering';

export function useOfferingEditor({
  uuid,
  targetCompany,
  company,
  companyRead,
  data,
  onClose,
}: {
  uuid?: string;
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
    data.assertCurrent();
    if (uuid) data.assertOffering(uuid, 'edit');
    if (uuid) {
      const state = client.getQueryState<import('@ledova/shared').Offering>(
        companyOfferingDetailKey(targetCompany, companyRead.scopeKey, uuid),
      );
      if (
        state?.status !== 'success' ||
        state.fetchStatus !== 'idle' ||
        !state.data ||
        state.data.uuid !== uuid ||
        !state.data.canBeEdited
      )
        throw createUserFriendlyError('Refresh the current offering before continuing.');
    }
  };
  const belongs = company?.uuid === targetCompany;
  const editable =
    !uuid || (detail.data?.canBeEdited && data.tokens.some((token) => token.uuid === detail.data?.tokenUuid));
  const blocked =
    !belongs ||
    !editable ||
    !!companyRead.error ||
    companyRead.isRefreshing ||
    !!data.error ||
    data.isRefreshing ||
    (uuid !== undefined && (detail.isError || detail.isFetching));
  const request = useMutation({
    mutationFn: async (input: OfferingInput) => {
      guard();
      const requestConfig = { ...config, ledovaSubmissionGuard: guard };
      const result = uuid
        ? await updateOffering(apiClient, uuid, input, requestConfig)
        : await createOffering(apiClient, input, requestConfig);
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
  const refetch = async () => {
    const companyResult = companyRead.error ? await companyRead.refetch() : [];
    await data.refetch();
    if (uuid) await detail.refetch();
    return companyResult;
  };
  return { detail, pendingRef, belongs, editable, blocked, request, refetch };
}

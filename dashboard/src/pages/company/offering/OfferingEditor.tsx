import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import {
  apiErrorSentence,
  createUserFriendlyError,
  createOffering,
  updateOffering,
  type Company,
  type OfferingInput,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyReadNotice, type CompanyActionRead } from '../CompanyState';
import { OfferingForm } from './OfferingForm';
import { OfferingReadNotice } from './OfferingReadNotice';
import { useCompanyOffering, type useOfferings } from './useOffering';

export function OfferingEditor({
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
  const pending = useRef(false);
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
      const state = client.getQueryState<import('@ledova/shared').Offering>([
        'offering',
        targetCompany,
        companyRead.scopeKey,
        uuid,
      ]);
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
      pending.current = false;
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
  return (
    <Modal
      isOpen
      title={uuid ? 'Edit offering' : 'New offering'}
      size="xl"
      onClose={() => {
        if (!request.isPending) onClose();
      }}
    >
      <div className="space-y-4">
        <CompanyReadNotice read={{ ...companyRead, refetch }} />
        <OfferingReadNotice read={{ ...data, refetch }} />
        {uuid && (
          <OfferingReadNotice
            read={{ error: detail.error, isRefreshing: detail.isFetching, refetch }}
            label="Current offering"
          />
        )}
        {!belongs && (
          <p role="alert" className="text-sm text-text-muted">
            This draft belongs to a company that is no longer selected.
          </p>
        )}
        {uuid && detail.data && !editable && !detail.isFetching && !detail.isError && (
          <p role="alert" className="text-sm text-text-muted">
            This offering can no longer be edited.
          </p>
        )}
        {request.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(request.error, 'The offering could not be saved. Try again.')}
          </p>
        )}
        {(!uuid || detail.data) && (
          <OfferingForm
            tokens={data.tokens.filter((token) =>
              uuid ? token.uuid === detail.data?.tokenUuid : token.status === 'deployed',
            )}
            busy={request.isPending}
            blocked={blocked}
            settlementAssets={data.settlementAssets}
            documents={company?.documents ?? []}
            operatorName={data.operatorName}
            editing={uuid ? detail.data : undefined}
            onCreate={(input) => {
              if (!blocked && !request.isPending && !pending.current) {
                pending.current = true;
                request.mutate(input);
              }
            }}
            onUpdate={(input) => {
              if (!blocked && !request.isPending && !pending.current) {
                pending.current = true;
                request.mutate(input);
              }
            }}
            onCancelEdit={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

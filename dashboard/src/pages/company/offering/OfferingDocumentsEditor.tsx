import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import {
  OFFERING_PUBLISHED_STATUSES,
  OFFER_DOCUMENT_COPY,
  addOfferingDocuments,
  apiErrorSentence,
  createUserFriendlyError,
  attachableDocuments,
  type Company,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyReadNotice, type CompanyActionRead } from '../CompanyState';
import { DocumentChoices } from './DocumentChoices';
import { OfferingReadNotice } from './OfferingReadNotice';
import { useCompanyOffering, type useOfferings } from './useOffering';

export function OfferingDocumentsEditor({
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
    data.assertOffering(uuid, 'documents');
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
      pending.current = false;
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
  return (
    <Modal
      isOpen
      title={OFFER_DOCUMENT_COPY.ADD}
      size="lg"
      onClose={() => {
        if (!request.isPending) onClose();
      }}
    >
      <fieldset disabled={request.isPending} className="space-y-4">
        <CompanyReadNotice read={{ ...companyRead, refetch }} />
        <OfferingReadNotice
          read={{ error: detail.error, isRefreshing: detail.isFetching, refetch }}
          label="Current offering"
        />
        <p className="text-sm text-text-muted">{OFFER_DOCUMENT_COPY.ADD_HELP}</p>
        {request.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(request.error, OFFER_DOCUMENT_COPY.ADD_FAILED)}
          </p>
        )}
        {detail.data && !published && (
          <p role="alert" className="text-sm text-error-light">
            {OFFER_DOCUMENT_COPY.ADD_UNAVAILABLE}
          </p>
        )}
        {detail.data && published && (
          <div className="space-y-2">
            {documents.every((document) => kept.includes(document.uuid)) && (
              <p className="text-sm text-text-muted">{OFFER_DOCUMENT_COPY.ADD_NONE}</p>
            )}
            <DocumentChoices
              documents={documents}
              chosen={chosen}
              kept={kept}
              onToggle={(document) =>
                setChosen((current) =>
                  current.includes(document) ? current.filter((each) => each !== document) : [...current, document],
                )
              }
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-4">
          <PageAction label="Cancel" onClick={onClose} disabled={request.isPending} />
          <PageAction
            label={OFFER_DOCUMENT_COPY.ADD}
            primary
            onClick={() => {
              if (!blocked && addable.length > 0 && !request.isPending && !pending.current) {
                pending.current = true;
                request.mutate(addable);
              }
            }}
            disabled={blocked || addable.length === 0 || request.isPending}
          />
        </div>
      </fieldset>
    </Modal>
  );
}

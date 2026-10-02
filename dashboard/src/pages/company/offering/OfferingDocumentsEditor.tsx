import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import {
  OFFERING_PUBLISHED_STATUSES,
  OFFER_DOCUMENT_COPY,
  addOfferingDocuments,
  apiErrorSentence,
  attachableDocuments,
  useOfferingUnderEdit,
  type Company,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyReadNotice, type CompanyRead } from '../CompanyState';
import { DocumentChoices } from './DocumentChoices';
import { OfferingReadNotice } from './OfferingReadNotice';

export function OfferingDocumentsEditor({
  uuid,
  targetCompany,
  company,
  companyRead,
  refresh,
  onClose,
}: {
  uuid: string;
  targetCompany: string;
  company: Company | null;
  companyRead: CompanyRead;
  refresh: () => Promise<unknown>;
  onClose: () => void;
}) {
  const detail = useOfferingUnderEdit(uuid);
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
    mutationFn: (added: string[]) => addOfferingDocuments(apiClient, uuid, added),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  const addable = chosen.filter((document) => !kept.includes(document));
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
        <CompanyReadNotice read={companyRead} />
        <OfferingReadNotice
          read={{ error: detail.error, isRefreshing: detail.isFetching, refetch: detail.refetch }}
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
              if (!blocked && addable.length > 0 && !request.isPending) request.mutate(addable);
            }}
            disabled={blocked || addable.length === 0 || request.isPending}
          />
        </div>
      </fieldset>
    </Modal>
  );
}

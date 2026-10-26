import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { OFFER_DOCUMENT_COPY, apiErrorSentence, type Company } from '@ledova/shared';
import { CompanyReadNotice, type CompanyActionRead } from '@components/CompanyState';
import { DocumentChoices } from './DocumentChoices';
import { type useOfferings } from './useOffering';
import { useOfferingDocumentsEditor } from './useOfferingDocumentsEditor';

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
  const { detail, pendingRef, chosen, setChosen, kept, documents, published, blocked, request, addable, refetch } =
    useOfferingDocumentsEditor({
      uuid,
      targetCompany,
      company,
      companyRead,
      data,
      onClose,
    });
  return (
    <Modal isOpen title={OFFER_DOCUMENT_COPY.ADD} size="lg" busy={request.isPending} onClose={onClose}>
      <fieldset disabled={request.isPending} className="space-y-4">
        <CompanyReadNotice read={{ ...companyRead, refetch }} />
        <CompanyReadNotice
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
              if (!blocked && addable.length > 0 && !request.isPending && !pendingRef.current) {
                pendingRef.current = true;
                request.mutate(addable);
              }
            }}
            busy={request.isPending}
            busyLabel="Adding documents…"
            disabled={blocked || addable.length === 0}
          />
        </div>
      </fieldset>
    </Modal>
  );
}

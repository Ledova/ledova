import { Modal } from '@components/Modal';
import { apiErrorSentence, type Company } from '@ledova/shared';
import { CompanyReadNotice, type CompanyActionRead } from '@pages/company/shared/CompanyState';
import { OfferingForm } from './OfferingForm';
import { type useOfferings } from './useOffering';
import { useOfferingEditor } from './useOfferingEditor';

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
  const { detail, pendingRef, belongs, editable, blocked, request, refetch } = useOfferingEditor({
    uuid,
    targetCompany,
    company,
    companyRead,
    data,
    onClose,
  });
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
        <CompanyReadNotice read={{ ...data, refetch }} label="Offering information" />
        {uuid && (
          <CompanyReadNotice
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
              if (!blocked && !request.isPending && !pendingRef.current) {
                pendingRef.current = true;
                request.mutate(input);
              }
            }}
            onUpdate={(input) => {
              if (!blocked && !request.isPending && !pendingRef.current) {
                pendingRef.current = true;
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

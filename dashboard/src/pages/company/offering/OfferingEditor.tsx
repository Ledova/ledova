import { useMutation } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import { apiErrorSentence, createOffering, updateOffering, type Company, type OfferingInput } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyReadNotice, type CompanyRead } from '../CompanyState';
import { OfferingForm } from './OfferingForm';
import { OfferingReadNotice } from './OfferingReadNotice';
import { useOfferingUnderEdit, type useOfferings } from './useOffering';

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
  companyRead: CompanyRead;
  data: ReturnType<typeof useOfferings>;
  onClose: () => void;
}) {
  const detail = useOfferingUnderEdit(uuid);
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
    mutationFn: (input: OfferingInput) =>
      uuid ? updateOffering(apiClient, uuid, input) : createOffering(apiClient, input),
    onSuccess: async () => {
      await data.refresh();
      onClose();
    },
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
        <CompanyReadNotice read={companyRead} />
        <OfferingReadNotice read={data} />
        {uuid && (
          <OfferingReadNotice
            read={{ error: detail.error, isRefreshing: detail.isFetching, refetch: detail.refetch }}
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
            operatorName={data.operatorName}
            editing={uuid ? detail.data : undefined}
            onCreate={(input) => {
              if (!blocked && !request.isPending) request.mutate(input);
            }}
            onUpdate={(input) => {
              if (!blocked && !request.isPending) request.mutate(input);
            }}
            onCancelEdit={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

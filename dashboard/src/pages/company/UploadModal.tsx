import { FileField } from '@components/Field';
import { Modal } from '@components/Modal';
import { apiErrorSentence, type DocumentType } from '@ledova/shared';
import { useCompanyDocumentUpload } from './useCompanyDocumentUpload';
import { CompanyReadNotice, type CompanyActionRead } from '@pages/company/shared/CompanyState';

export function UploadModal({
  companyUuid,
  documentType,
  label,
  canUpload,
  read,
  onClose,
  onSuccess,
}: {
  companyUuid: string;
  documentType: DocumentType;
  label: string;
  canUpload: boolean;
  read: CompanyActionRead;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}) {
  const { setFile, pendingRef, upload, valid } = useCompanyDocumentUpload({
    companyUuid,
    documentType,
    canUpload,
    read,
    onClose,
    onSuccess,
  });
  return (
    <Modal
      isOpen
      title={`Upload ${label}`}
      showFooter
      confirmLabel="Upload"
      busy={upload.isPending}
      busyLabel="Uploading…"
      confirmDisabled={!valid}
      onConfirm={() => {
        if (valid && !pendingRef.current) {
          pendingRef.current = true;
          upload.mutate();
        }
      }}
      onClose={onClose}
    >
      <fieldset
        disabled={upload.isPending}
        className="space-y-4"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
        }}
      >
        <CompanyReadNotice read={read} />
        {!canUpload && !read.error && !read.isRefreshing && (
          <p role="alert" className="text-sm text-text-muted">
            Current company administration is required to upload documents for the selected company.
          </p>
        )}
        {upload.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(
              upload.error,
              'The document could not be uploaded. Try again.',
              'The upload outcome could not be confirmed. Refresh the documents before retrying.',
            )}
          </p>
        )}
        <FileField label="Document file" onFile={setFile} />
      </fieldset>
    </Modal>
  );
}

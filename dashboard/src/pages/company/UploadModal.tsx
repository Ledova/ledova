import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
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
  const { file, setFile, input, pendingRef, upload, valid } = useCompanyDocumentUpload({
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
      <fieldset disabled={upload.isPending} className="space-y-4">
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
        {file ? (
          <div className="space-y-2 text-sm">
            <p className="break-all">{file.name}</p>
            <PageAction label="Remove selected file" onClick={() => setFile(null)} disabled={upload.isPending} />
          </div>
        ) : (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!upload.isPending) setFile(event.dataTransfer.files[0] ?? null);
            }}
            className="space-y-3 py-4"
          >
            <p className="text-sm text-text-muted">
              Drop your document here or choose a file. PDF or images, up to 10 MB.
            </p>
            <PageAction label="Choose document file" onClick={() => input.current?.click()} />
            <input
              ref={input}
              type="file"
              aria-label="Document file"
              className="hidden"
              accept="application/pdf,image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </fieldset>
    </Modal>
  );
}

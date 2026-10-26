import { FileField } from '@components/Field';
import { SelectField } from '@components/SelectField';
import { useEffect, useRef } from 'react';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { apiErrorSentence, type DocumentType } from '@ledova/shared';
import { useCompanyDocumentUpload } from './useCompanyDocumentUpload';
import { CompanyReadNotice, type CompanyActionRead } from '@pages/company/shared/CompanyState';

export function CompanyDocumentForm({
  companyUuid,
  documentType,
  documentTypes,
  onTypeChange,
  label,
  canUpload,
  read,
  onClose,
  onSuccess,
}: {
  companyUuid: string;
  documentType: DocumentType;
  documentTypes: { type: DocumentType; label: string }[];
  onTypeChange: (type: DocumentType) => void;
  label: string;
  canUpload: boolean;
  read: CompanyActionRead;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}) {
  const { setFile, pendingRef, upload, available, problems } = useCompanyDocumentUpload({
    companyUuid,
    documentType,
    canUpload,
    read,
    onClose,
    onSuccess,
  });
  const checks = useErrorSummary(problems);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => form.current?.focus(), []);
  return (
    <form
      aria-label={`Upload ${label}`}
      ref={form}
      tabIndex={-1}
      noValidate
      className="space-y-4 focus:outline-none"
      onSubmit={(event) => {
        event.preventDefault();
        if (available && checks.check() && !pendingRef.current) {
          pendingRef.current = true;
          upload.mutate();
        }
      }}
    >
      <fieldset
        disabled={upload.isPending}
        className="space-y-4"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          if (!(event.target instanceof HTMLInputElement) || event.target.disabled) event.preventDefault();
        }}
      >
        <ErrorSummary {...checks.summary} />
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
        <SelectField
          label="Category"
          options={documentTypes.map(({ type, label: name }) => ({ value: type, label: name }))}
          value={documentType}
          disabled={!available}
          onChange={(type) => onTypeChange(type as DocumentType)}
        />
        <FileField {...checks.field('file')} label="File" showUploadHint={false} onFile={setFile} />
      </fieldset>
      <FormActions>
        <PageAction label="Cancel" disabled={upload.isPending} onClick={onClose} />
        <PageAction
          type="submit"
          primary
          label="Upload"
          busy={upload.isPending}
          busyLabel="Uploading…"
          disabled={!available}
        />
      </FormActions>
    </form>
  );
}

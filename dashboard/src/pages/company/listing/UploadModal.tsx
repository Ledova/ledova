import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { apiErrorSentence, createUserFriendlyError, uploadCompanyDocument, type DocumentType } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyReadNotice, type CompanyActionRead } from '../CompanyState';

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
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [assertCurrent] = useState(() => read.assertCurrent);
  const guard = (uuid: string) => {
    if (!mounted.current) throw createUserFriendlyError('This upload is closed. Reopen it before continuing.');
    assertCurrent(uuid);
  };
  const [config] = useState(() => read.requestConfig(companyUuid));
  const valid = !!file && canUpload && !read.error && !read.isRefreshing;
  const upload = useMutation({
    mutationFn: async () => {
      guard(companyUuid);
      const result = await uploadCompanyDocument(
        apiClient,
        companyUuid,
        { documentType, name: file!.name, file: file! },
        { ...config, ledovaSubmissionGuard: () => guard(companyUuid) },
      );
      guard(companyUuid);
      if (
        !result.data.uuid ||
        result.data.company !== companyUuid ||
        result.data.documentType !== documentType ||
        result.data.name !== file!.name ||
        !result.data.fileUrl
      )
        throw createUserFriendlyError(
          'The upload outcome could not be confirmed. Refresh the documents before retrying.',
        );
      return result;
    },
    onSuccess: async () => {
      guard(companyUuid);
      await onSuccess();
      guard(companyUuid);
      onClose();
    },
    onSettled: () => {
      pending.current = false;
    },
  });
  return (
    <Modal
      isOpen
      title={`Upload ${label}`}
      showFooter
      confirmLabel="Upload"
      confirmLoading={upload.isPending}
      confirmDisabled={!valid || upload.isPending}
      onConfirm={() => {
        if (valid && !pending.current) {
          pending.current = true;
          upload.mutate();
        }
      }}
      onClose={() => {
        if (!upload.isPending) onClose();
      }}
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

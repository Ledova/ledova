import { useRef, type MouseEvent } from 'react';
import { apiErrorSentence, formatDate, type Company, type CompanyDocument } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { Modal } from '@components/Modal';
import { useCompanyDocuments } from './useCompanyDocuments';
import type { CompanyActionRead } from '@components/CompanyState';
import { CompanyDocumentForm } from './CompanyDocumentForm';

function DocumentRecord({
  document,
  editable,
  ready,
  onView,
  onRemove,
}: {
  document: CompanyDocument;
  editable: boolean;
  ready: boolean;
  onView: (document: CompanyDocument, event: MouseEvent<HTMLAnchorElement>) => void;
  onRemove: (document: CompanyDocument) => void;
}) {
  return (
    <div className="grid items-start gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="space-y-1">
        <p className="break-all text-text-primary">{document.name}</p>
        <p className="text-text-muted">
          Uploaded {formatDate(document.createdAt)} · {document.isVerified ? 'Verified' : 'Not verified'}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 break-all">
        {document.fileUrl && (
          <a
            href={document.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-brand-light underline"
            onClick={(event) => onView(document, event)}
          >
            View <span className="sr-only">{document.name}</span>
          </a>
        )}
        {editable && (
          <PageAction label="Remove" context={document.name} disabled={!ready} onClick={() => onRemove(document)} />
        )}
      </div>
    </div>
  );
}

export function CompanyDocuments({
  company,
  read,
  editable,
  refresh,
}: {
  company: Company;
  read: CompanyActionRead;
  editable: boolean;
  refresh: () => Promise<unknown>;
}) {
  const {
    error,
    removing,
    confirmationRef,
    pendingRef,
    remove,
    ready,
    populatedTypes,
    availableTypes,
    uploadChoice,
    viewDocument,
    removeDocument,
    upload,
    setUpload,
    setRemoving,
  } = useCompanyDocuments({ company, read, editable, refresh });
  const uploadAction = useRef<HTMLButtonElement>(null);
  const closeUpload = () => {
    setUpload(null);
    requestAnimationFrame(() => uploadAction.current?.focus());
  };
  return (
    <>
      {!read.error && !read.isRefreshing && !read.canAdmin && (
        <p className="text-sm text-text-muted">
          Current company administration is required to access company documents.
        </p>
      )}
      {((!read.error && read.canAdmin) || upload) && (
        <Section title={upload ? 'Upload document' : 'Supporting documents'}>
          <div hidden={!!upload} className="space-y-4">
            <p className="text-sm text-text-muted">Private supporting documents for company administrators.</p>
            {populatedTypes.length === 0 ? (
              <p className="text-sm text-text-muted">No supporting documents yet.</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {populatedTypes.map(({ type, label, documents }) => (
                  <li key={type} className="space-y-4 py-4">
                    <h3 className="text-sm font-medium text-text-primary">{label}</h3>
                    {documents.map((document) => (
                      <DocumentRecord
                        key={document.uuid}
                        document={document}
                        editable={editable}
                        ready={ready}
                        onView={viewDocument}
                        onRemove={removeDocument}
                      />
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <FormActions>
                <PageAction
                  ref={uploadAction}
                  label="Upload document"
                  primary
                  disabled={!ready || !uploadChoice}
                  onClick={() => uploadChoice && setUpload({ type: uploadChoice.type, label: uploadChoice.label })}
                />
              </FormActions>
            )}
          </div>
          {upload && (
            <CompanyDocumentForm
              key={company.uuid}
              companyUuid={company.uuid}
              documentType={upload.type}
              documentTypes={availableTypes}
              onTypeChange={(type) => {
                const choice = availableTypes.find((item) => item.type === type);
                if (choice) setUpload({ type: choice.type, label: choice.label });
              }}
              label={upload.label}
              canUpload={ready}
              read={read}
              onClose={closeUpload}
              onSuccess={refresh}
            />
          )}
        </Section>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {removing && read.canAdmin && (
        <Modal
          isOpen
          title="Remove company document?"
          showFooter
          confirmLabel="Remove document"
          destructive
          confirmDisabled={!ready}
          busy={remove.isPending}
          busyLabel="Removing document…"
          onClose={() => {
            if (!pendingRef.current) {
              confirmationRef.current = null;
              setRemoving(null);
            }
          }}
          onConfirm={() => {
            if (!ready || pendingRef.current || confirmationRef.current !== removing) return;
            confirmationRef.current = null;
            pendingRef.current = true;
            remove.mutate(removing);
          }}
        >
          <p className="text-sm text-text-primary">
            Remove {removing.name} from {company.name}? Documents retained by an offering cannot be removed.
          </p>
          {remove.isError && (
            <p role="alert" className="text-sm text-error-light">
              {apiErrorSentence(remove.error, 'The document could not be removed. Refresh or retry.')}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

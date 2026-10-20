import { SelectField } from '@components/SelectField';
import type { MouseEvent } from 'react';
import { apiErrorSentence, formatDate, type Company, type CompanyDocument } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { Modal } from '@components/Modal';
import { useCompanyDocuments } from './useCompanyDocuments';
import type { CompanyActionRead } from '@pages/company/shared/CompanyState';
import { UploadModal } from './UploadModal';

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
    <div className="space-y-2 text-sm">
      <p className="break-all text-text-primary">{document.name}</p>
      <p className="text-text-muted">
        Uploaded {formatDate(document.createdAt)} · {document.isVerified ? 'Verified' : 'Not verified'}
      </p>
      <div className="flex flex-wrap items-center gap-2 break-all">
        {document.fileUrl && (
          <a
            href={document.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-brand-light underline"
            onClick={(event) => onView(document, event)}
          >
            View {document.name}
          </a>
        )}
        {editable && (
          <PageAction label={`Remove ${document.name}`} disabled={!ready} onClick={() => onRemove(document)} />
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
  onAction,
}: {
  company: Company;
  read: CompanyActionRead;
  editable: boolean;
  refresh: () => Promise<unknown>;
  onAction?: () => void;
}) {
  const {
    documentsSection,
    error,
    removing,
    confirmationRef,
    pendingRef,
    remove,
    ready,
    populatedTypes,
    availableTypes,
    uploadChoice,
    setSelectedType,
    viewDocument,
    removeDocument,
    upload,
    setUpload,
    setRemoving,
  } = useCompanyDocuments({ company, read, editable, refresh, onAction });
  return (
    <>
      {!read.error && !read.isRefreshing && !read.canAdmin && (
        <p className="text-sm text-text-muted">
          Current company administration is required to access company documents.
        </p>
      )}
      {!read.error && read.canAdmin && (
        <div ref={documentsSection} id="documents" className="scroll-mt-4">
          <Section title="Company documents">
            <p className="text-sm text-text-muted">
              Upload supporting documents when needed. Company setup does not require an upload; use Other documents for
              representative authority records. Company administrators can access them; they do not change your
              appointment or permissions.
            </p>
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
              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <SelectField
                  label="Document type"
                  options={availableTypes.map(({ type, label }) => ({ value: type, label }))}
                  value={uploadChoice?.type ?? 'other'}
                  disabled={!ready}
                  onChange={(value) => {
                    const choice = availableTypes.find((item) => item.type === value);
                    if (choice) setSelectedType(choice.type);
                  }}
                />
                <PageAction
                  label="Upload document"
                  primary
                  disabled={!ready || !uploadChoice}
                  onClick={() => uploadChoice && setUpload({ type: uploadChoice.type, label: uploadChoice.label })}
                />
              </div>
            )}
          </Section>
        </div>
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
          confirmDisabled={!ready}
          confirmLoading={remove.isPending}
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
      {upload && (
        <UploadModal
          key={`${company.uuid}/${upload.type}`}
          companyUuid={company.uuid}
          documentType={upload.type}
          label={upload.label}
          canUpload={ready}
          read={read}
          onClose={() => setUpload(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  OPTIONAL_DOCUMENTS,
  REQUIRED_DOCUMENTS,
  apiErrorSentence,
  createUserFriendlyError,
  deleteCompanyDocument,
  formatDate,
  type Company,
  type CompanyDocument,
  type DocumentType,
} from '@ledova/shared';
import { Section, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { Modal } from '@components/Modal';
import apiClient from '@services/apiClient';
import type { CompanyActionRead } from './CompanyState';
import { UploadModal } from './listing/UploadModal';

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
  const client = useQueryClient();
  const [upload, setUpload] = useState<{ type: DocumentType; label: string } | null>(null);
  const [removing, setRemoving] = useState<CompanyDocument | null>(null);
  const confirmation = useRef<CompanyDocument | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      confirmation.current = null;
    };
  }, []);
  useEffect(() => {
    if (!read.error && !read.isRefreshing && !read.canAdmin) {
      confirmation.current = null;
    }
  }, [read.canAdmin, read.error, read.isRefreshing]);
  const [assertCurrent] = useState(() => read.assertCurrent);
  const [config] = useState(() => read.requestConfig(company.uuid));
  const guard = (uuid: string) => {
    if (!mounted.current) throw createUserFriendlyError('This company action is closed. Reopen it before continuing.');
    assertCurrent(uuid);
  };
  const documentGuard = (document: CompanyDocument) => {
    guard(company.uuid);
    const current = client
      .getQueryData<Company>(read.companyKey)
      ?.documents.find((item) => item.uuid === document.uuid);
    if (
      !current ||
      current.company !== company.uuid ||
      document.company !== company.uuid ||
      current.fileUrl !== document.fileUrl ||
      current.documentType !== document.documentType
    )
      throw createUserFriendlyError('The document changed. Refresh before continuing.');
  };
  const remove = useMutation({
    mutationFn: async (document: CompanyDocument) => {
      documentGuard(document);
      const result = await deleteCompanyDocument(apiClient, company.uuid, document.uuid, {
        ...config,
        ledovaSubmissionGuard: () => documentGuard(document),
      });
      guard(company.uuid);
      if (result.status !== 204)
        throw createUserFriendlyError('The deletion outcome could not be confirmed. Refresh before retrying.');
      return result;
    },
    onSuccess: async () => {
      guard(company.uuid);
      await refresh();
      guard(company.uuid);
      setRemoving(null);
    },
    onError: (_failure, document) => {
      try {
        guard(company.uuid);
        const next = { ...document };
        confirmation.current = next;
        setRemoving(next);
      } catch {
        confirmation.current = null;
      }
    },
    onSettled: () => {
      pending.current = false;
    },
  });
  if (removing && !read.error && !read.isRefreshing && !read.canAdmin) setRemoving(null);
  const viewDocument = (document: CompanyDocument, event: MouseEvent<HTMLAnchorElement>) => {
    try {
      documentGuard(document);
    } catch (failure) {
      event.preventDefault();
      setError(apiErrorSentence(failure, 'The document could not be opened. Refresh before continuing.'));
    }
  };
  const removeDocument = (document: CompanyDocument) => {
    onAction?.();
    remove.reset();
    const next = { ...document };
    confirmation.current = next;
    setRemoving(next);
  };
  const ready = editable && !read.error && !read.isRefreshing && !remove.isPending;
  const groups = [
    { title: 'Required documents', types: REQUIRED_DOCUMENTS, required: true },
    { title: 'Optional documents', types: OPTIONAL_DOCUMENTS, required: false },
  ];
  return (
    <>
      {!read.error && !read.isRefreshing && !read.canAdmin && (
        <p className="text-sm text-text-muted">
          Current company administration is required to access company documents.
        </p>
      )}
      {!read.error &&
        read.canAdmin &&
        groups.map(({ title, types, required }) => (
          <Section key={title} title={title}>
            <ul className="divide-y divide-border-subtle">
              {types.map(({ type, label }) => {
                const matches = company.documents.filter((document) => document.documentType === type);
                return (
                  <li key={type} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-medium text-text-primary">{label}</h3>
                      <Status tone={matches.length ? 'done' : 'waiting'}>
                        {matches.length ? 'Uploaded' : required ? 'Required' : 'Optional'}
                      </Status>
                    </div>
                    {matches.map((document) => (
                      <DocumentRecord
                        key={document.uuid}
                        document={document}
                        editable={editable}
                        ready={ready}
                        onView={viewDocument}
                        onRemove={removeDocument}
                      />
                    ))}
                    {editable && (matches.length === 0 || type === 'other') && (
                      <PageAction
                        label={`Upload ${label}`}
                        disabled={!ready}
                        onClick={() => setUpload({ type, label })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        ))}
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
            if (!pending.current) {
              confirmation.current = null;
              setRemoving(null);
            }
          }}
          onConfirm={() => {
            if (!ready || pending.current || confirmation.current !== removing) return;
            confirmation.current = null;
            pending.current = true;
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

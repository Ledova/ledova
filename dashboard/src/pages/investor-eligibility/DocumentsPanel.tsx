import { Field, FileField, TextInput } from '@components/Field';
import { SelectField } from '@components/SelectField';
import { FormActions, PageAction } from '@components/Page';
import { Confirmation } from '@components/Modal';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  DOCUMENT_TYPE_LABELS,
  FIELD_LIMITS,
  apiErrorSentence,
  attachedClaimLabel,
  documentClaimOptions,
  extractionState,
  formatDate,
  payslipDetails,
  useAttachDocument,
  useDeleteDocument,
  useDocument,
  useDocuments,
  useInvestorClassifications,
  useUploadDocument,
  type InvestorClassification,
  type Document,
} from '@ledova/shared';
import { useEffect, useRef, useState } from 'react';
import { LoadError, Loading, Row, Rows, ShowMore, Status, Failure } from '@components/Ledger';

function PayslipResult({ extraction }: { extraction: Document['latestExtraction'] }) {
  const details = payslipDetails(extraction);
  if (!details) return null;
  return (
    <>
      <ShowMore show="Show extraction details" hide="Hide extraction details">
        <Rows>
          {details.fields.map((field) => (
            <Row key={field.label} label={field.label}>
              {field.value}
            </Row>
          ))}
        </Rows>
      </ShowMore>
      {details.warnings.length > 0 && <p className="text-sm text-warning-light">{details.warnings.join(' · ')}</p>}
    </>
  );
}

function ClaimSelector({
  id,
  error,
  claims,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  error?: string | null;
  claims: InvestorClassification[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <SelectField
      id={id}
      error={error}
      label="Classification claim"
      options={documentClaimOptions(claims)}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function DocumentCard({ initialDoc, claims }: { initialDoc: Document; claims: InvestorClassification[] }) {
  const liveQuery = useDocument(initialDoc.uuid);
  const doc = liveQuery.data ?? initialDoc;
  const extraction = doc.latestExtraction;
  const state = extractionState(extraction?.status);
  const del = useDeleteDocument();
  const attach = useAttachDocument();
  const [classification, setClassification] = useState('');
  const attachment = useErrorSummary({
    classification: !classification && 'Choose the claim to attach this payslip to.',
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = attach.isPending || del.isPending;

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-medium text-text-primary">{doc.originalFilename}</h3>
          <p className="text-sm text-text-muted">
            {DOCUMENT_TYPE_LABELS[doc.documentType]} · {formatDate(doc.createdAt, '—')}
          </p>
        </div>
        <Status tone={state.tone}>{state.label}</Status>
      </div>
      {doc.classification ? (
        <Rows>
          <Row label="Classification claim">{attachedClaimLabel(doc.classification, claims)}</Row>
          <Row label="Retained">
            {doc.retentionUntil ? `Until ${formatDate(doc.retentionUntil, '—')}` : 'With the claim'}
          </Row>
        </Rows>
      ) : (
        <fieldset className="min-w-0 space-y-4">
          <legend className="sr-only">Attach {doc.originalFilename} to a claim</legend>
          <ErrorSummary {...attachment.summary} />
          <ClaimSelector
            {...attachment.field('classification')}
            claims={claims}
            value={classification}
            onChange={setClassification}
            disabled={busy}
          />
          <p className="text-sm text-text-muted">
            Unattached payslips are removed{' '}
            {doc.retentionUntil ? `on ${formatDate(doc.retentionUntil, '—')}` : 'according to the retention policy'}.
          </p>
          <FormActions>
            <PageAction
              label="Delete document"
              context={doc.originalFilename}
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            />
            <PageAction
              primary
              label="Attach to claim"
              context={doc.originalFilename}
              busy={attach.isPending}
              busyLabel="Attaching…"
              disabled={del.isPending}
              onClick={() => {
                if (attachment.check()) attach.mutate({ uuid: doc.uuid, classification });
              }}
            />
          </FormActions>
        </fieldset>
      )}
      {(attach.error || del.error) && (
        <Failure>{apiErrorSentence(attach.error || del.error, 'The document could not be updated.')}</Failure>
      )}
      {confirmingDelete && (
        <Confirmation
          isOpen
          title="Delete this document?"
          confirmLabel="Delete document"
          busy={del.isPending}
          busyLabel="Deleting…"
          onClose={() => setConfirmingDelete(false)}
          onConfirm={() => del.mutate(doc.uuid, { onSettled: () => setConfirmingDelete(false) })}
        >
          {doc.originalFilename} is deleted. This can&apos;t be undone.
        </Confirmation>
      )}
      <PayslipResult extraction={extraction} />
      {extraction?.status === 'failed' && extraction.error && <Failure>{extraction.error}</Failure>}
    </li>
  );
}

function UploadCard({ claims }: { claims: InvestorClassification[] }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selection, setSelection] = useState(0);
  const [note, setNote] = useState('');
  const [classification, setClassification] = useState('');
  const formHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const upload = useUploadDocument();
  useEffect(() => {
    if (open) formHeading.current?.focus();
    else if (returnFocus.current && !upload.isPending && opener.current) {
      returnFocus.current = false;
      opener.current.focus();
    }
  }, [open, upload.isPending]);
  const close = () => {
    returnFocus.current = true;
    setOpen(false);
  };
  const handleSubmit = () => {
    if (!file) return;
    upload.mutate(
      { file, documentType: 'payslip', note, classification: classification || undefined },
      {
        onSuccess: () => {
          setFile(null);
          setSelection((current) => current + 1);
          setNote('');
          setClassification('');
          close();
        },
      },
    );
  };

  return (
    <>
      <div hidden={open}>
        <FormActions>
          <PageAction ref={opener} label="Upload a payslip" onClick={() => setOpen(true)} />
        </FormActions>
      </div>
      <form
        hidden={!open}
        aria-label="Upload supporting payslip"
        className="space-y-4 border-t border-border-subtle pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <h3 ref={formHeading} tabIndex={-1} className="text-sm font-medium text-text-primary focus:outline-none">
          Upload a payslip
        </h3>
        <FileField key={selection} label="File" disabled={upload.isPending} onFile={setFile} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Note">
            <TextInput
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={FIELD_LIMITS.NOTE}
              disabled={upload.isPending}
            />
          </Field>
          <ClaimSelector
            claims={claims}
            value={classification}
            onChange={setClassification}
            disabled={upload.isPending}
          />
        </div>
        {upload.error && <Failure>{apiErrorSentence(upload.error, 'The payslip could not be uploaded.')}</Failure>}
        <FormActions>
          <PageAction label="Cancel" context="payslip upload" disabled={upload.isPending} onClick={close} />
          <PageAction
            type="submit"
            primary
            label="Upload and extract"
            busy={upload.isPending}
            busyLabel="Uploading…"
            disabled={!file}
          />
        </FormActions>
      </form>
    </>
  );
}

export function DocumentsPanel() {
  const docs = useDocuments();
  const claimsQuery = useInvestorClassifications();
  const claims = claimsQuery.data ?? [];
  const list = docs.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Payslips support classification claims for human review; extraction does not establish eligibility. They are
        private to you and permitted platform operations staff. Issuers cannot review them.
      </p>
      {claimsQuery.isError && (
        <LoadError retry={() => claimsQuery.refetch()} busy={claimsQuery.isFetching}>
          Your classification claims could not be loaded.
        </LoadError>
      )}
      {claimsQuery.isSuccess && !claims.some((claim) => claim.status === 'submitted') && (
        <p className="text-sm text-text-muted">Submit a claim before attaching supporting evidence.</p>
      )}
      {docs.isLoading && <Loading>Loading your documents…</Loading>}
      {docs.isError && (
        <LoadError retry={() => docs.refetch()} busy={docs.isFetching}>
          Your documents could not be loaded.
        </LoadError>
      )}
      {docs.isSuccess && list.length === 0 && <p className="text-sm text-text-muted">No documents yet.</p>}
      {list.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {list.map((doc) => (
            <DocumentCard key={doc.uuid} initialDoc={doc} claims={claims} />
          ))}
        </ul>
      )}
      <UploadCard claims={claims} />
    </div>
  );
}

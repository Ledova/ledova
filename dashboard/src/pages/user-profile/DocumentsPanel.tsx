import { SelectField } from '@components/SelectField';
import { PageAction } from '@components/Page';
import { Choices } from '@components/Choices';
import { DESTINATIONS } from '@ledova/shared';
import { useRef, useState } from 'react';
import {
  CloudArrowUpIcon,
  FileTextIcon,
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
  ClockIcon,
  TrashIcon,
} from '@phosphor-icons/react';

import { apiErrorSentence, formatDate, formatFileSize, type InvestorClassification } from '@ledova/shared';
import { ICON_SM, ICON_MD } from '@components/iconSizes';

import {
  useAttachDocument,
  useDeleteDocument,
  useDocument,
  useDocumentClaims,
  useDocuments,
  useUploadDocument,
} from './useDocuments';
import type { Document, UserDocumentType, ExtractionStatus } from '@ledova/shared';

const DOCUMENT_TYPE_LABELS: Record<UserDocumentType, string> = {
  payslip: 'Payslip',
  bank_statement: 'Bank statement',
  tax_return: 'Tax return',
  other: 'Other',
};

const DOCUMENT_TYPES = [
  ['payslip', 'Payslip'],
  ['bank_statement', 'Bank statement (coming soon)'],
  ['tax_return', 'Tax return (coming soon)'],
] as const;

const MAX_FILE_MB = 10;

const claimLabel = (claim: InvestorClassification) => `${claim.categoryDisplay} · ${formatDate(claim.createdAt)}`;

function formatDocumentMoney(raw: string | null): string {
  if (!raw) return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return raw;
  return n.toLocaleString(undefined, { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });
}

function formatDocumentDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusPill({ status }: { status: ExtractionStatus | undefined }) {
  if (!status || status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-tertiary text-xs text-text-muted">
        <ClockIcon size={ICON_SM} /> Queued
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brand-light/10 text-xs text-brand-light">
        <ClockIcon size={ICON_SM} weight="bold" /> Extracting…
      </span>
    );
  }
  if (status === 'succeeded') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 text-xs text-success-light">
        <CheckCircleIcon size={ICON_SM} weight="fill" /> Extracted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error/10 text-xs text-error-light">
      <XCircleIcon size={ICON_SM} weight="fill" /> Failed
    </span>
  );
}

function PayslipResult({ data, durationMs }: { data: object; durationMs: number | null }) {
  const text = (name: string): string | null => {
    const value: unknown = Reflect.get(data, name);
    return typeof value === 'string' ? value : null;
  };
  const warnings: unknown = Reflect.get(data, 'extractionWarnings');
  const confidence: unknown = Reflect.get(data, 'confidence');
  const readableWarnings = Array.isArray(warnings)
    ? warnings.filter((value): value is string => typeof value === 'string')
    : [];
  const fields: { label: string; value: string }[] = [
    { label: 'Employee', value: text('employeeName') ?? '—' },
    { label: 'Employer', value: text('employerName') ?? '—' },
    { label: 'ABN', value: text('abn') ?? '—' },
    {
      label: 'Pay period',
      value: `${formatDocumentDate(text('periodStart'))} → ${formatDocumentDate(text('periodEnd'))}`,
    },
    { label: 'Gross pay', value: formatDocumentMoney(text('grossPay')) },
    { label: 'Net pay', value: formatDocumentMoney(text('netPay')) },
    { label: 'Tax withheld', value: formatDocumentMoney(text('taxWithheld')) },
    { label: 'Superannuation', value: formatDocumentMoney(text('superannuation')) },
    { label: 'YTD gross', value: formatDocumentMoney(text('ytdGross')) },
    { label: 'YTD tax', value: formatDocumentMoney(text('ytdTax')) },
  ];

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {fields.map((f) => (
          <div key={f.label} className="flex justify-between items-baseline text-sm gap-2 min-w-0">
            <span className="text-text-muted">{f.label}</span>
            <span className="text-text-primary text-right truncate">{f.value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 mt-2 border-t border-border-subtle text-xs text-text-muted">
        <span>Confidence: {typeof confidence === 'number' ? `${(confidence * 100).toFixed(0)}%` : 'Unknown'}</span>
        {durationMs != null && <span>Extracted in {(durationMs / 1000).toFixed(1)}s</span>}
      </div>

      {readableWarnings.length > 0 && (
        <div className="mt-2 flex items-start gap-2 text-xs text-warning-light">
          <WarningIcon size={ICON_SM} weight="bold" className="mt-0.5 flex-shrink-0" />
          <span>{readableWarnings.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

function ClaimSelector({
  claims,
  value,
  onChange,
  disabled,
}: {
  claims: InvestorClassification[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <SelectField
      label="Classification claim"
      options={[
        { value: '', label: 'Keep unattached' },
        ...claims
          .filter((claim) => claim.status === 'submitted')
          .map((claim) => ({ value: claim.uuid, label: claimLabel(claim), reference: claim.uuid.slice(0, 8) })),
      ]}
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
  const attached = claims.find((claim) => claim.uuid === doc.classification);
  const attachedLabel = attached
    ? claims.some((claim) => claim.uuid !== attached.uuid && claimLabel(claim) === claimLabel(attached))
      ? `${claimLabel(attached)} · ${attached.uuid.slice(0, 8)}`
      : claimLabel(attached)
    : doc.classification?.slice(0, 8);
  const del = useDeleteDocument();
  const attach = useAttachDocument();
  const [classification, setClassification] = useState('');

  const handleDelete = () => {
    if (!window.confirm(`Delete "${doc.originalFilename}"? This cannot be undone.`)) return;
    del.mutate(doc.uuid);
  };

  return (
    <div className="border-t border-border-subtle pt-3">
      <div className="flex items-center gap-3">
        <FileTextIcon size={ICON_MD} className="text-text-muted flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text-primary truncate">{doc.originalFilename}</p>
          <p className="text-xs text-text-muted">
            {DOCUMENT_TYPE_LABELS[doc.documentType]} · {formatDocumentDate(doc.createdAt)}
          </p>
        </div>
        <StatusPill status={extraction?.status} />
        {!doc.classification && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            title="Delete document"
            className="p-1.5 text-text-muted hover:text-error-light transition-colors disabled:opacity-50 flex-shrink-0"
          >
            <TrashIcon size={ICON_SM} weight="regular" />
          </button>
        )}
      </div>

      {doc.classification ? (
        <p className="mt-3 text-xs text-text-muted">
          Attached to claim {attachedLabel}. Retained{' '}
          {doc.retentionUntil ? `until ${formatDocumentDate(doc.retentionUntil)}` : 'with the claim'}.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <ClaimSelector
            claims={claims}
            value={classification}
            onChange={setClassification}
            disabled={attach.isPending}
          />
          <PageAction
            primary
            label="Attach to claim"
            busy={attach.isPending}
            busyLabel="Attaching…"
            disabled={!classification}
            onClick={() => attach.mutate({ uuid: doc.uuid, classification })}
          />
          <p className="text-xs text-text-muted">
            Unattached payslips are removed{' '}
            {doc.retentionUntil ? `on ${formatDocumentDate(doc.retentionUntil)}` : 'according to the retention policy'}.
          </p>
        </div>
      )}
      {(attach.error || del.error) && (
        <p role="alert" className="mt-2 text-sm text-error-light">
          {apiErrorSentence(attach.error || del.error, 'The document could not be updated.')}
        </p>
      )}

      {extraction?.status === 'succeeded' &&
        extraction.parsedJson !== null &&
        typeof extraction.parsedJson === 'object' &&
        !Array.isArray(extraction.parsedJson) && (
          <PayslipResult data={extraction.parsedJson} durationMs={extraction.durationMs} />
        )}

      {extraction?.status === 'failed' && extraction.error && (
        <p className="mt-3 flex items-start gap-2 text-xs text-error-light">
          <XCircleIcon size={ICON_SM} weight="fill" className="mt-0.5 flex-shrink-0" />
          <span>{extraction.error}</span>
        </p>
      )}
    </div>
  );
}

function UploadCard({ claims }: { claims: InvestorClassification[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<UserDocumentType>('payslip');
  const [note, setNote] = useState('');
  const [classification, setClassification] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDocument();

  const handleSubmit = async () => {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      alert(`File too large. Max ${MAX_FILE_MB} MB.`);
      return;
    }
    upload.mutate(
      { file, documentType, note, classification: classification || undefined },
      {
        onSuccess: () => {
          setFile(null);
          setNote('');
          setClassification('');
          if (fileInputRef.current) fileInputRef.current.value = '';
        },
      },
    );
  };

  return (
    <div className="border border-dashed border-border rounded-lg p-4 space-y-3">
      {!file ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center py-6 text-text-muted hover:text-text-primary transition"
        >
          <CloudArrowUpIcon size={32} className="mb-2" />
          <p className="text-sm">Click to upload a payslip</p>
          <p className="text-xs mt-1">PDF or image, max {MAX_FILE_MB} MB</p>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <FileTextIcon size={ICON_MD} className="text-brand-light flex-shrink-0" weight="regular" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate">{file.name}</p>
              <p className="text-xs text-text-muted">{formatFileSize(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-text-muted hover:text-text-primary p-1 flex-shrink-0"
              disabled={upload.isPending}
            >
              <XCircleIcon size={20} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Choices<UserDocumentType>
              legend="Document type"
              options={DOCUMENT_TYPES}
              value={documentType}
              unavailable={['bank_statement', 'tax_return']}
              disabled={upload.isPending}
              onChange={setDocumentType}
            />
            <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm text-text-primary">
              Note (optional)
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={255}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
                disabled={upload.isPending}
              />
            </label>
          </div>

          <ClaimSelector
            claims={claims}
            value={classification}
            onChange={setClassification}
            disabled={upload.isPending}
          />
          <PageAction
            primary
            label="Upload & extract"
            busy={upload.isPending}
            busyLabel="Uploading…"
            onClick={() => void handleSubmit()}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/jpg"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      {upload.error && (
        <p role="alert" className="text-sm text-error-light">
          {apiErrorSentence(upload.error, 'The payslip could not be uploaded.')}
        </p>
      )}
    </div>
  );
}

export function DocumentsPanel() {
  const docs = useDocuments();
  const claimsQuery = useDocumentClaims();
  const claims = claimsQuery.data?.data?.results ?? [];
  const list = docs.data?.results ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Attach a payslip to an existing classification claim for human review. Uploading or extracting a payslip does
        not establish eligibility.
      </p>
      <p className="text-sm text-text-muted">
        Your payslips are private to you and permitted platform operations staff. Issuers cannot review them.
      </p>
      <UploadCard claims={claims} />
      {!claims.some((claim) => claim.status === 'submitted') && (
        <a href={DESTINATIONS.investorEligibility.path} className="text-sm text-brand-light">
          Submit a classification claim to attach supporting evidence.
        </a>
      )}

      {docs.isLoading && <p className="text-sm text-text-muted">Loading…</p>}

      {!docs.isLoading && list.length === 0 && (
        <p className="text-sm text-text-muted">No documents yet — upload your first payslip above.</p>
      )}

      {list.map((doc) => (
        <DocumentCard key={doc.uuid} initialDoc={doc} claims={claims} />
      ))}
    </div>
  );
}

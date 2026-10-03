import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  getErrorMessage,
  submitCompanyAuthorityRequest,
  type CompanyAuthorityRequest,
  type CompanyCapability,
  type CompanyListItem,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';

export function AuthorityRequestForm({
  company,
  disabled,
  guard,
  onSuccess,
}: {
  company: CompanyListItem;
  disabled: boolean;
  guard: () => void;
  onSuccess: (request: CompanyAuthorityRequest) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [requested, setRequested] = useState<CompanyCapability[]>(['admin']);
  const [delegatable, setDelegatable] = useState<CompanyCapability[]>([]);
  const [expiry, setExpiry] = useState('');
  const key = useRef<string | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!active.current) throw new Error('The selected company changed. Reopen the request to continue.');
  };
  const submission = useMutation({
    mutationFn: async () => {
      check();
      key.current ??= crypto.randomUUID();
      const response = await submitCompanyAuthorityRequest(
        apiClient,
        {
          company: company.uuid,
          file: file!,
          idempotencyKey: key.current,
          requestedCapabilities: requested,
          delegatableCapabilities: delegatable,
          ...(expiry ? { requestedExpiresAt: `${expiry}T23:59:59Z` } : {}),
        },
        { ledovaSubmissionGuard: check },
      );
      check();
      return response;
    },
    onSuccess: ({ data }) => onSuccess(data),
  });
  const change = (apply: () => void) => {
    key.current = null;
    submission.reset();
    apply();
  };
  const busy = submission.isPending;
  const ready = !disabled && !busy && !!file && (requested.length > 0 || delegatable.length > 0);
  const toggle = (values: CompanyCapability[], value: CompanyCapability) =>
    values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value].sort();
  const send = async () => {
    if (!ready || submitting.current) return;
    submitting.current = true;
    try {
      await submission.mutateAsync();
    } catch {
      return;
    } finally {
      submitting.current = false;
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-sm text-text-muted">
        Company information is provided by the company. Submit a private request for your own representative role at
        {company.name}, then accept the authorisation declaration to establish your appointment. Submitting evidence
        alone grants no authority and does not activate the company.
      </p>
      <p className="text-sm text-text-muted">
        Initial admission requires Manage company team in your own requested actions. Your evidence and request history
        remain private to your account; no ASIC extract is required.
      </p>
      {(['requested', 'delegatable'] as const).map((scope) => {
        const values = scope === 'requested' ? requested : delegatable;
        const set = scope === 'requested' ? setRequested : setDelegatable;
        return (
          <fieldset key={scope} disabled={disabled || busy} className="space-y-2">
            <legend className="text-sm font-medium text-text-primary">
              {scope === 'requested'
                ? 'Actions you request for yourself'
                : 'Actions you request permission to delegate'}
            </legend>
            {COMPANY_AUTHORITY_CAPABILITIES.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={values.includes(value)}
                  onChange={() => change(() => set(toggle(values, value)))}
                />
                {label}
              </label>
            ))}
          </fieldset>
        );
      })}
      <label className="block space-y-1 text-sm text-text-primary">
        Requested expiry date (UTC, optional)
        <input
          type="date"
          value={expiry}
          disabled={disabled || busy}
          onChange={(event) => change(() => setExpiry(event.target.value))}
          className={FIELD_CLASS}
        />
      </label>
      <label className="block space-y-1 text-sm text-text-primary">
        Representative evidence
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          disabled={disabled || busy}
          onChange={(event) => change(() => setFile(event.target.files?.[0] ?? null))}
          className={FIELD_CLASS}
        />
      </label>
      <p className="text-sm text-text-muted">
        PDF or image, max 10 MB. Use a new request when evidence or terms change.
      </p>
      {submission.isError && (
        <p role="alert" className="text-sm text-error-light">
          {getErrorMessage(submission.error, 'The request could not be recorded. Retry with the same details.')}
        </p>
      )}
      <PageAction
        label={busy ? 'Submitting…' : 'Submit authority request'}
        onClick={() => void send()}
        disabled={!ready}
      />
    </form>
  );
}

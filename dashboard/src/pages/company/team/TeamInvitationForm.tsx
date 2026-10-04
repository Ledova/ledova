import { useEffect, useRef, useState } from 'react';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  createCompanyTeamInvitation,
  getErrorMessage,
  type CompanyCapability,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { sameScope } from './appointments';

export function TeamInvitationForm({
  source,
  available,
  disabled,
  guard,
  onRecorded,
  onBusy,
}: {
  source: OwnCompanyAppointment;
  available: CompanyCapability[];
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
}) {
  const [personal, setPersonal] = useState<CompanyCapability[]>([]);
  const [delegatable, setDelegatable] = useState<CompanyCapability[]>([]);
  const [deadline, setDeadline] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recorded, setRecorded] = useState<{ uuid: string; code: string | null } | null>(null);
  const key = useRef<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw new Error('Your selected appointment changed. Reopen the invitation.');
  };
  const change = (apply: () => void) => {
    key.current = null;
    setError('');
    apply();
  };
  const toggle = (values: CompanyCapability[], value: CompanyCapability) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort();
  const send = async () => {
    if (disabled || pending.current || recorded || (!personal.length && !delegatable.length)) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      check();
      if (![...personal, ...delegatable].every((value) => available.includes(value)))
        throw new Error('Your delegation scope changed. Choose the permitted actions again.');
      key.current ??= crypto.randomUUID();
      const { data, status } = await createCompanyTeamInvitation(
        apiClient,
        {
          company: source.company,
          inviterAppointment: source.uuid,
          idempotencyKey: key.current,
          capabilities: personal,
          delegatableCapabilities: delegatable,
          ...(deadline ? { acceptanceDeadline: `${deadline}T23:59:59Z` } : {}),
          ...(expiry ? { appointmentExpiresAt: `${expiry}T23:59:59Z` } : {}),
        },
        { ledovaSubmissionGuard: check },
      );
      check();
      if (
        typeof data.uuid !== 'string' ||
        !data.uuid ||
        data.company !== source.company ||
        data.inviterAppointment !== source.uuid ||
        data.idempotencyKey !== key.current ||
        !sameScope(data.capabilities, personal) ||
        !sameScope(data.delegatableCapabilities, delegatable) ||
        (deadline && Date.parse(data.acceptanceDeadline) !== Date.parse(`${deadline}T23:59:59Z`)) ||
        (expiry
          ? Date.parse(data.appointmentExpiresAt ?? '') !== Date.parse(`${expiry}T23:59:59Z`)
          : data.appointmentExpiresAt !== null) ||
        !Number.isFinite(Date.parse(data.acceptanceDeadline)) ||
        !(
          (status === 200 && data.code === null) ||
          (status === 201 && typeof data.code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(data.code))
        )
      )
        throw new Error('The invitation outcome could not be confirmed. Retry with the same details.');
      setRecorded({ uuid: data.uuid, code: data.code });
      onRecorded();
    } catch (failure) {
      if (mounted.current) {
        try {
          guard();
          setError(
            getErrorMessage(failure, 'The invitation could not be recorded. Retry with the same details.') ??
              'The invitation could not be recorded. Retry with the same details.',
          );
        } catch {
          return;
        }
      }
    } finally {
      pending.current = false;
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };
  if (recorded)
    return (
      <div role="status" className="space-y-3 text-sm text-text-primary">
        <p>Invitation recorded: {recorded.uuid}.</p>
        {recorded.code ? (
          <>
            <p>
              Copy this one-time code now and share it directly with the person you appoint. It will not be shown in
              history.
            </p>
            <label className="block space-y-1">
              One-time invitation code
              <input className={FIELD_CLASS} value={recorded.code} readOnly autoComplete="off" />
            </label>
          </>
        ) : (
          <p>No code is available on this retry. Use the original code, or create a new invitation if it was lost.</p>
        )}
        <PageAction
          label="Create another invitation"
          disabled={disabled}
          onClick={() => {
            key.current = null;
            setRecorded(null);
            setPersonal([]);
            setDelegatable([]);
            setDeadline('');
            setExpiry('');
          }}
        />
      </div>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-sm text-text-muted">
        Personal actions and permission to delegate are separate. Choose only actions your selected appointment may
        delegate.
      </p>
      {(['personal', 'delegatable'] as const).map((scope) => {
        const values = scope === 'personal' ? personal : delegatable;
        const set = scope === 'personal' ? setPersonal : setDelegatable;
        return (
          <fieldset key={scope} disabled={disabled || busy} className="space-y-2">
            <legend className="text-sm font-medium text-text-primary">
              {scope === 'personal' ? 'Actions for the appointee' : 'Actions the appointee may delegate'}
            </legend>
            {COMPANY_AUTHORITY_CAPABILITIES.filter(({ value }) => available.includes(value)).map(({ value, label }) => (
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
        Invitation deadline (UTC, optional)
        <input
          className={FIELD_CLASS}
          type="date"
          value={deadline}
          disabled={disabled || busy}
          onChange={(event) => change(() => setDeadline(event.target.value))}
        />
      </label>
      <p className="text-sm text-text-muted">
        The default acceptance deadline is seven days. A chosen deadline must be within 30 days.
      </p>
      <label className="block space-y-1 text-sm text-text-primary">
        Appointment expiry (UTC, optional)
        <input
          className={FIELD_CLASS}
          type="date"
          value={expiry}
          disabled={disabled || busy}
          onChange={(event) => change(() => setExpiry(event.target.value))}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <PageAction
        label={busy ? 'Creating invitation…' : 'Create invitation'}
        disabled={disabled || busy || (!personal.length && !delegatable.length)}
        onClick={() => void send()}
      />
    </form>
  );
}

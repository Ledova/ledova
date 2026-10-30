import { useId } from 'react';
import { Field, TextInput } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FormActions, PageAction } from '@components/Page';
import { Outcome } from '@components/Ledger';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  type CompanyCapability,
  type OwnCompanyAppointment,
  addCalendarDays,
  utcToday,
} from '@ledova/shared';
import { useTeamInvitationForm } from './useTeamInvitationForm';

export function TeamInvitationForm({
  source,
  available,
  disabled,
  guard,
  onRecorded,
  onBusy,
  onCancel,
}: {
  source: OwnCompanyAppointment;
  available: CompanyCapability[];
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
  onCancel: () => void;
}) {
  const {
    personal,
    setPersonal,
    delegatable,
    setDelegatable,
    deadline,
    setDeadline,
    expiry,
    setExpiry,
    busy,
    error,
    problems,
    watchDate,
    recorded,
    setRecorded,
    keyRef,
    change,
    toggle,
    send,
  } = useTeamInvitationForm({
    source,
    available,
    disabled,
    guard,
    onRecorded,
    onBusy,
  });
  const checks = useErrorSummary(problems);
  const actions = checks.field('actions');
  const actionsError = useId();
  const outcome = <Outcome>{recorded && 'Invitation recorded.'}</Outcome>;
  if (recorded)
    return (
      <>
        {outcome}
        <div className="space-y-3 text-sm text-text-primary">
          {recorded.code ? (
            <>
              <p>
                Copy this one-time code now and share it directly with the person you appoint. It will not be shown in
                history.
              </p>
              <Field label="One-time invitation code">
                <TextInput value={recorded.code} readOnly autoComplete="off" />
              </Field>
            </>
          ) : (
            <p>No code is available on this retry. Use the original code, or create a new invitation if it was lost.</p>
          )}
          <FormActions>
            <PageAction label="Done" disabled={disabled} onClick={onCancel} />
            <PageAction
              label="Create another invitation"
              disabled={disabled}
              onClick={() => {
                keyRef.current = null;
                setRecorded(null);
                setPersonal([]);
                setDelegatable([]);
                setDeadline('');
                setExpiry('');
                checks.reset();
              }}
            />
          </FormActions>
        </div>
      </>
    );
  return (
    <>
      {outcome}
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (checks.check()) void send();
        }}
      >
        <ErrorSummary {...checks.summary} />
        <p className="max-w-prose text-sm text-text-muted">
          Personal actions and permission to delegate are separate. Choose only actions your selected appointment may
          delegate.
        </p>
        <div id={actions.id}>
          <div className="grid gap-5 sm:grid-cols-2">
            {(['personal', 'delegatable'] as const).map((scope) => {
              const values = scope === 'personal' ? personal : delegatable;
              const set = scope === 'personal' ? setPersonal : setDelegatable;
              return (
                <fieldset key={scope} disabled={disabled || busy} className="space-y-2">
                  <legend className="text-sm font-medium text-text-primary">
                    {scope === 'personal' ? 'Actions for the appointee' : 'Actions the appointee may delegate'}
                  </legend>
                  {COMPANY_AUTHORITY_CAPABILITIES.filter(({ value }) => available.includes(value)).map(
                    ({ value, label }) => (
                      <label key={value} className="flex items-start gap-2 text-sm text-text-primary">
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          aria-invalid={actions.error ? true : undefined}
                          aria-describedby={actions.error ? actionsError : undefined}
                          checked={values.includes(value)}
                          onChange={() => change(() => set(toggle(values, value)))}
                        />
                        {label}
                      </label>
                    ),
                  )}
                </fieldset>
              );
            })}
          </div>
          {actions.error && (
            <p id={actionsError} className="mt-1 text-sm text-error-light">
              {actions.error}
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...checks.field('deadline')} label="Invitation deadline (UTC)">
            <TextInput
              type="date"
              min={utcToday()}
              max={addCalendarDays(utcToday(), 29)}
              value={deadline}
              {...watchDate('deadline')}
              disabled={disabled || busy}
              onChange={(event) => change(() => setDeadline(event.target.value))}
            />
          </Field>
          <Field {...checks.field('expiry')} label="Appointment expiry (UTC)">
            <TextInput
              type="date"
              min={utcToday()}
              value={expiry}
              {...watchDate('expiry')}
              disabled={disabled || busy}
              onChange={(event) => change(() => setExpiry(event.target.value))}
            />
          </Field>
        </div>
        <p className="text-sm text-text-muted">
          The default acceptance deadline is seven days. A chosen deadline must be within 30 days.
        </p>
        {error && (
          <p role="alert" className="text-sm text-error-light">
            {error}
          </p>
        )}
        <FormActions>
          <PageAction label="Cancel" disabled={busy} onClick={onCancel} />
          <PageAction
            type="submit"
            label="Create invitation"
            busy={busy}
            busyLabel="Creating invitation…"
            primary
            disabled={disabled}
          />
        </FormActions>
      </form>
    </>
  );
}

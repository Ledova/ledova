import { Field, TextInput } from '@components/Field';
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
}: {
  source: OwnCompanyAppointment;
  available: CompanyCapability[];
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
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
  if (recorded)
    return (
      <div className="space-y-3 text-sm text-text-primary">
        <Outcome>Invitation recorded.</Outcome>
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
          }}
        />
      </div>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-sm text-text-muted">
        Personal actions and permission to delegate are separate. Choose only actions your selected appointment may
        delegate.
      </p>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invitation deadline (UTC, optional)">
          <TextInput
            type="date"
            min={utcToday()}
            max={addCalendarDays(utcToday(), 29)}
            value={deadline}
            disabled={disabled || busy}
            onChange={(event) => change(() => setDeadline(event.target.value))}
          />
        </Field>
        <Field label="Appointment expiry (UTC, optional)">
          <TextInput
            type="date"
            min={utcToday()}
            value={expiry}
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
        <PageAction
          type="submit"
          label="Create invitation"
          busy={busy}
          busyLabel="Creating invitation…"
          primary
          disabled={disabled || (!personal.length && !delegatable.length)}
        />
      </FormActions>
    </form>
  );
}

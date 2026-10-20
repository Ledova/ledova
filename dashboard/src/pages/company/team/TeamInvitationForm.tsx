import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { FormActions, PageAction } from '@components/Page';
import { COMPANY_AUTHORITY_CAPABILITIES, type CompanyCapability, type OwnCompanyAppointment } from '@ledova/shared';
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
        <label className={LABEL}>
          Invitation deadline (UTC, optional)
          <input
            className={FIELD_CLASS}
            type="date"
            value={deadline}
            disabled={disabled || busy}
            onChange={(event) => change(() => setDeadline(event.target.value))}
          />
        </label>
        <label className={LABEL}>
          Appointment expiry (UTC, optional)
          <input
            className={FIELD_CLASS}
            type="date"
            value={expiry}
            disabled={disabled || busy}
            onChange={(event) => change(() => setExpiry(event.target.value))}
          />
        </label>
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

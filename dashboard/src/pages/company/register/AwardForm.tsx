import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { REGISTER_AWARD_COPY as COPY, type OwnCompanyAppointment, type Person } from '@ledova/shared';
import { PersonFields, PersonSelect } from '@pages/company/register/shared/PersonPicker';
import { useAwardForm } from './useAwardForm';

export function AwardForm({
  company,
  token,
  people,
  appointment,
  guard,
  blocked,
  onRecorded,
  onHeldChange,
  visible = true,
  canPrepare = true,
}: {
  company: string;
  token: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
  canPrepare?: boolean;
}) {
  const {
    member,
    setMember,
    name,
    setName,
    address,
    setAddress,
    shares,
    setShares,
    termsOn,
    setTermsOn,
    terms,
    setTerms,
    schedule,
    setSchedule,
    setFile,
    busy,
    held,
    error,
    today,
    problem,
    submit,
  } = useAwardForm({
    company,
    token,
    people,
    appointment,
    guard,
    blocked,
    onRecorded,
    onHeldChange,
    visible,
    canPrepare,
  });
  if (!visible) return null;
  return (
    <form
      className="space-y-5 rounded-xl border border-border-subtle bg-surface-tertiary p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy || blocked || held || !canPrepare} className="space-y-4">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="pb-2 text-base font-medium">Person and promised shares</legend>
          <PersonSelect
            label="Promised recipient"
            people={people.filter((row) => row.walletless && row.particularsRetained)}
            value={member}
            onChange={setMember}
          />
          {member === 'new' && (
            <PersonFields name={name} residentialAddress={address} onName={setName} onResidentialAddress={setAddress} />
          )}
          <label className={LABEL}>
            {COPY.SHARES}
            <input
              className={FIELD_CLASS}
              inputMode="numeric"
              maxLength={78}
              value={shares}
              onChange={(event) => setShares(event.target.value.trim())}
            />
          </label>
        </fieldset>
        <fieldset className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>label:has(textarea)]:sm:col-span-2">
          <legend className="pb-2 text-base font-medium">Agreement</legend>
          <label className={LABEL}>
            {COPY.TERMS_ON}
            <input
              className={FIELD_CLASS}
              type="date"
              max={today}
              value={termsOn}
              onChange={(event) => setTermsOn(event.target.value)}
            />
          </label>
          <label className={LABEL}>
            {COPY.TERMS}
            <textarea
              className={FIELD_CLASS}
              maxLength={1000}
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
            />
          </label>
          <label className={LABEL}>
            {COPY.AGREEMENT_DOCUMENT}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className={FIELD_CLASS}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-sm text-text-muted">PDF or image, max 10 MB. {COPY.NOTE}</p>
        </fieldset>
        <fieldset className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>label:has(textarea)]:sm:col-span-2">
          <legend className="pb-2 text-base font-medium">Vesting schedule</legend>
          <label className={LABEL}>
            {COPY.SCHEDULE}
            <textarea
              className={FIELD_CLASS}
              maxLength={1000}
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
            />
          </label>
          <p className="text-sm text-text-muted">
            Retain the company&apos;s schedule. Each vesting event is recorded separately; dates create no vesting or
            issued shares.
          </p>
        </fieldset>
      </fieldset>
      {problem && <p className="text-sm text-text-muted">{problem}</p>}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {held && <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>}
      <FormActions>
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Recording award…"
          disabled={blocked || (!held && (!canPrepare || !!problem))}
        />
      </FormActions>
    </form>
  );
}

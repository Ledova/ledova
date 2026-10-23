import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FIELD_LIMITS, REGISTER_AWARD_COPY as COPY, type OwnCompanyAppointment, type Person } from '@ledova/shared';
import { PersonFields, PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { useAwardForm } from './useAwardForm';

export function AwardForm({
  company,
  token,
  people,
  appointment,
  guard,
  blocked,
  onRecorded,
  onCancel,
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
  onCancel: () => void;
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
    problems,
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
  const checks = useErrorSummary(problems);
  const cancel = (
    <PageAction label="Cancel" context="award preparation" disabled={busy || blocked || held} onClick={onCancel} />
  );
  if (!visible) return <FormActions>{cancel}</FormActions>;
  return (
    <form
      className="space-y-5 border-t border-border-subtle pt-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (held || checks.check()) void submit();
      }}
    >
      <ErrorSummary {...checks.summary} />
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
            <PersonFields
              name={name}
              residentialAddress={address}
              onName={setName}
              onResidentialAddress={setAddress}
              nameCheck={checks.field('name')}
              addressCheck={checks.field('address')}
            />
          )}
          <Field {...checks.field('shares')} label={COPY.SHARES}>
            <TextInput
              inputMode="numeric"
              maxLength={FIELD_LIMITS.REGISTER_SHARES}
              value={shares}
              onChange={(event) => setShares(event.target.value.trim())}
            />
          </Field>
        </fieldset>
        <fieldset className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>div:has(textarea)]:sm:col-span-2">
          <legend className="pb-2 text-base font-medium">Agreement</legend>
          <Field {...checks.field('termsOn')} label={COPY.TERMS_ON}>
            <TextInput type="date" max={today} value={termsOn} onChange={(event) => setTermsOn(event.target.value)} />
          </Field>
          <Field {...checks.field('terms')} label={COPY.TERMS}>
            <TextArea maxLength={FIELD_LIMITS.TERMS} value={terms} onChange={(event) => setTerms(event.target.value)} />
          </Field>
          <FileField {...checks.field('file')} label={COPY.AGREEMENT_DOCUMENT} onFile={setFile} />
          <p className="text-sm text-text-muted">{COPY.NOTE}</p>
        </fieldset>
        <fieldset className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>div:has(textarea)]:sm:col-span-2">
          <legend className="pb-2 text-base font-medium">Vesting schedule</legend>
          <Field
            {...checks.field('schedule')}
            label={COPY.SCHEDULE}
            hint="Retain the company's schedule. Each vesting event is recorded separately; dates create no vesting or issued shares."
          >
            <TextArea
              maxLength={FIELD_LIMITS.TERMS}
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
            />
          </Field>
        </fieldset>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {held && <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>}
      <FormActions>
        {cancel}
        <PageAction
          type="submit"
          primary
          label={COPY.SUBMIT}
          busy={busy}
          busyLabel="Recording award…"
          disabled={blocked || (!held && !canPrepare)}
        />
      </FormActions>
    </form>
  );
}

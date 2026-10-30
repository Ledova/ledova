import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FIELD_LIMITS, REGISTER_AWARD_COPY as COPY, type OwnCompanyAppointment, type Person } from '@ledova/shared';
import { PersonFields, PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { useAwardForm } from './useAwardForm';
import { Failure } from '@components/Ledger';

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
        <fieldset className="min-w-0 space-y-4">
          <legend className="sr-only">Recipient and shares</legend>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <PersonSelect
              label="Recipient"
              people={people.filter((row) => row.walletless && row.particularsRetained)}
              value={member}
              onChange={setMember}
            />
            <Field {...checks.field('shares')} label={COPY.SHARES}>
              <TextInput
                inputMode="numeric"
                maxLength={FIELD_LIMITS.REGISTER_SHARES}
                value={shares}
                onChange={(event) => setShares(event.target.value.trim())}
              />
            </Field>
          </div>
          {member === 'new' && (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <PersonFields
                name={name}
                residentialAddress={address}
                onName={setName}
                onResidentialAddress={setAddress}
                nameCheck={checks.field('name')}
                addressCheck={checks.field('address')}
              />
            </div>
          )}
        </fieldset>
        <div className="grid items-start gap-6 border-t border-border-subtle pt-4 lg:grid-cols-2">
          <fieldset className="min-w-0 space-y-4">
            <legend className="pb-4 text-base font-medium">Agreement</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field {...checks.field('termsOn')} label="Date">
                <TextInput
                  type="date"
                  max={today}
                  value={termsOn}
                  onChange={(event) => setTermsOn(event.target.value)}
                />
              </Field>
              <FileField {...checks.field('file')} label="Document" showUploadHint={false} onFile={setFile} />
            </div>
            <Field {...checks.field('terms')} label="Terms">
              <TextArea
                rows={4}
                maxLength={FIELD_LIMITS.TERMS}
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
              />
            </Field>
          </fieldset>
          <fieldset className="min-w-0 space-y-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <legend className="pb-4 text-base font-medium">Vesting</legend>
            <Field
              {...checks.field('schedule')}
              label="Schedule"
              hint="Record each actual vesting event separately; dates do not vest or issue shares."
            >
              <TextArea
                rows={6}
                maxLength={FIELD_LIMITS.TERMS}
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
              />
            </Field>
          </fieldset>
        </div>
      </fieldset>
      <Failure>{error}</Failure>
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

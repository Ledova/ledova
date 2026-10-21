import { Field, TextInput, FileField } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FIELD_LIMITS, REGISTER_ALLOTMENT_COPY as COPY, type OwnCompanyAppointment, type Person } from '@ledova/shared';
import { PersonFields, PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { useAllotmentForm, type DocumentKind } from './useAllotmentForm';

const LIMITS: Partial<Record<string, number>> = {
  shares: FIELD_LIMITS.REGISTER_SHARES,
  consideration: FIELD_LIMITS.AMOUNT,
  receivedAmount: FIELD_LIMITS.AMOUNT,
  agreementReference: FIELD_LIMITS.REFERENCE,
  terms: FIELD_LIMITS.TERMS,
  approvingDirector: FIELD_LIMITS.DIRECTOR,
  authorityReference: FIELD_LIMITS.REFERENCE,
  reason: FIELD_LIMITS.REASON,
};

const INPUT_MODES: Partial<Record<string, 'numeric' | 'decimal'>> = {
  shares: 'numeric',
  consideration: 'decimal',
  receivedAmount: 'decimal',
};

export function AllotmentForm({
  company,
  token,
  people,
  appointment,
  guard,
  newEffectGuard,
  blocked,
  onRecorded,
  onHeldChange,
  visible = true,
  initialMember,
}: {
  company: string;
  token: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  newEffectGuard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
  visible?: boolean;
  initialMember?: string;
}) {
  const { today, member, setMember, fields, setFiles, busy, held, error, problems, submit, setFields } =
    useAllotmentForm({
      company,
      token,
      people,
      initialMember,
      appointment,
      guard,
      newEffectGuard,
      blocked,
      onRecorded,
      onHeldChange,
      visible,
    });
  const checks = useErrorSummary(problems);
  const field = (key: Exclude<keyof typeof fields, 'name' | 'residentialAddress'>) => (
    <Field
      key={key}
      {...checks.field(key)}
      label={
        {
          shares: COPY.SHARES,
          companyEventOn: COPY.COMPANY_EVENT_ON,
          consideration: COPY.CONSIDERATION,
          receivedAmount: COPY.RECEIVED_AMOUNT,
          agreementReference: COPY.AGREEMENT_REFERENCE,
          agreementOn: COPY.AGREEMENT_ON,
          receivedOn: COPY.RECEIVED_ON,
          terms: COPY.TERMS,
          approvingDirector: COPY.DIRECTOR,
          authorityReference: COPY.AUTHORITY_REFERENCE,
          reason: COPY.REASON,
        }[key]
      }
    >
      <TextInput
        type={key.endsWith('On') ? 'date' : 'text'}
        max={key.endsWith('On') ? today : undefined}
        value={fields[key]}
        maxLength={LIMITS[key]}
        inputMode={INPUT_MODES[key]}
        onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))}
      />
    </Field>
  );
  const document = (kind: DocumentKind) => (
    <FileField
      {...checks.field(`${kind}Document`)}
      label={COPY.DOCUMENTS[kind]}
      onFile={(file) => setFiles((current) => ({ ...current, [kind]: file ?? undefined }))}
    />
  );
  if (!visible) return null;
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
      <fieldset disabled={busy || blocked || held} className="space-y-4">
        <fieldset className="grid gap-4 pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2">
          <legend className="text-sm font-medium">1. Person and shares</legend>
          <PersonSelect
            label="Issue to"
            people={people.filter((row) => row.walletless && row.particularsRetained)}
            value={member}
            onChange={setMember}
          />
          {member === 'new' && (
            <PersonFields
              name={fields.name}
              residentialAddress={fields.residentialAddress}
              onName={(name) => setFields((current) => ({ ...current, name }))}
              onResidentialAddress={(residentialAddress) =>
                setFields((current) => ({ ...current, residentialAddress }))
              }
              nameCheck={checks.field('name')}
              addressCheck={checks.field('residentialAddress')}
            />
          )}
          {field('shares')}
          {field('consideration')}
        </fieldset>
        <fieldset className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2">
          <legend className="text-sm font-medium">2. Agreement and company receipt</legend>
          {field('agreementReference')}
          {field('agreementOn')}
          {field('terms')}
          {document('agreement')}
          {field('receivedAmount')}
          {field('receivedOn')}
          {document('receipt')}
          <p className="text-sm text-text-muted">{COPY.RECEIPT_NOTE}</p>
        </fieldset>
        <fieldset className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2">
          <legend className="text-sm font-medium">3. Company authority and review</legend>
          {field('companyEventOn')}
          {field('approvingDirector')}
          {field('authorityReference')}
          {field('reason')}
          {document('authority')}
          <p className="text-sm text-text-muted">
            The approving director must not be the recipient. Preparation records the agreement and receipt; approval
            and recording the share issue remain separate actions. {COPY.EFFECTIVE_NOTE}
          </p>
        </fieldset>
      </fieldset>
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
          busyLabel="Preparing allotment…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}

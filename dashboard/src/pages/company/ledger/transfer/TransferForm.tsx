import { useState } from 'react';
import { Field, TextInput, TextArea, FileField } from '@components/Field';
import { useTransferPreparation, type TransferFormProps } from './useTransferPreparation';
import { FIELD_LIMITS, REGISTER_TRANSFER_COPY as COPY, type Person, formatDate, shareCount } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { FormSteps } from '@components/FormSteps';
import { Row, Rows } from '@components/Ledger';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { PersonFields, PersonSelect } from '@pages/company/ledger/shared/PersonPicker';

const LIMITS: Partial<Record<string, number>> = {
  shares: FIELD_LIMITS.REGISTER_SHARES,
  terms: FIELD_LIMITS.TERMS,
  approvingDirector: FIELD_LIMITS.DIRECTOR,
  authorityReference: FIELD_LIMITS.REFERENCE,
  reason: FIELD_LIMITS.REASON,
};

const STEPS = [
  {
    id: 'people',
    label: 'People and shares',
    fields: ['fromMember', 'toMember', 'name', 'residentialAddress', 'shares', 'companyEventOn'],
  },
  {
    id: 'documents',
    label: 'Transfer documents',
    fields: ['signedOn', 'lodgedOn', 'terms', 'instrumentDocument'],
  },
  {
    id: 'review',
    label: 'Company authority and review',
    fields: ['approvingDirector', 'authorityReference', 'reason', 'authorityDocument'],
  },
] as const;

function inClass(person: Person) {
  return person.onRegister === false ? '' : `${shareCount(person.currentShares)} in this class`;
}

export function TransferForm({
  owner,
  guard,
  company,
  token,
  classLabel,
  people,
  appointment,
  blocked,
  onRefused,
  initialFrom,
  onCancel,
}: TransferFormProps & { classLabel: string }) {
  const {
    today,
    draft,
    files,
    setFiles,
    busy,
    error,
    operation,
    setOperation,
    change,
    eligible,
    from,
    recipient,
    fresh,
    problems,
    submit,
  } = useTransferPreparation({
    owner,
    guard,
    company,
    token,
    people,
    appointment,
    blocked,
    onRefused,
    initialFrom,
  });
  const checks = useErrorSummary(problems);
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('people');
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const field = (
    key: Exclude<keyof typeof draft, 'fromMember' | 'toMember' | 'name' | 'residentialAddress'>,
    label: string,
  ) => (
    <Field {...checks.field(key)} label={label}>
      {key === 'terms' ? (
        <TextArea
          rows={3}
          value={draft[key]}
          maxLength={LIMITS[key]}
          onChange={(event) => change(key, event.target.value)}
        />
      ) : (
        <TextInput
          type={key.endsWith('On') ? 'date' : 'text'}
          max={key.endsWith('On') ? today : undefined}
          inputMode={key === 'shares' ? 'numeric' : undefined}
          value={draft[key]}
          maxLength={LIMITS[key]}
          onChange={(event) => change(key, event.target.value)}
        />
      )}
    </Field>
  );
  const document = (kind: 'authority' | 'instrument', label: string) => (
    <FileField
      {...checks.field(`${kind}Document`)}
      label={label}
      showUploadHint={false}
      onFile={(file) => {
        setOperation(null);
        setFiles((current) => ({ ...current, [kind]: file ?? undefined }));
      }}
    />
  );

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || blocked) return;
        if (operation) {
          void submit();
          return;
        }
        if (step !== 'review') {
          if (checks.check(STEPS[stepIndex].fields)) setStep(STEPS[stepIndex + 1].id);
          return;
        }
        const invalid = STEPS.find((item) => item.fields.some((key) => problems[key]));
        if (invalid) {
          setStep(invalid.id);
          checks.check(invalid.fields);
        } else if (checks.check()) void submit();
      }}
    >
      <FormSteps label="Transfer steps" steps={STEPS} current={step} />
      <ErrorSummary {...checks.summary} />
      <fieldset disabled={busy || blocked || !!operation} className="space-y-4">
        <div hidden={step !== 'people'}>
          <fieldset className="space-y-4">
            <legend className="pb-4 text-base font-medium">People and shares</legend>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <PersonSelect
                {...checks.field('fromMember')}
                label={COPY.FROM}
                people={eligible.filter((member) => member.particularsRetained && BigInt(member.currentShares) > 0n)}
                value={draft.fromMember}
                onChange={(value) => change('fromMember', value)}
                allowNew={false}
                context={inClass}
              />
              <PersonSelect
                {...checks.field('toMember')}
                label={COPY.TO}
                people={eligible.filter((member) => member.member !== draft.fromMember)}
                value={draft.toMember}
                onChange={(value) => change('toMember', value)}
                context={inClass}
              />
            </div>
            {fresh && (
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <PersonFields
                  name={draft.name}
                  residentialAddress={draft.residentialAddress}
                  onName={(value) => change('name', value)}
                  onResidentialAddress={(value) => change('residentialAddress', value)}
                  nameCheck={checks.field('name')}
                  addressCheck={checks.field('residentialAddress')}
                />
              </div>
            )}
            {recipient?.lastCeasedOn && (
              <p className="text-sm text-text-muted">
                Last ceased in this class: {formatDate(recipient.lastCeasedOn)}. The same member ID is retained on
                return.
              </p>
            )}
            {fresh && draft.toMember !== 'new' && (
              <p className="text-sm text-text-muted">
                This member’s particulars passed the retention period. Supply their current particulars from the signed
                instrument, keeping their existing member ID.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('shares', COPY.SHARES)}
              {field('companyEventOn', COPY.COMPANY_EVENT_ON)}
            </div>
          </fieldset>
        </div>
        <div hidden={step !== 'documents'}>
          <fieldset className="space-y-4">
            <legend className="pb-4 text-base font-medium">Transfer documents</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('signedOn', 'Signed on')}
              {field('lodgedOn', 'Lodged with company on')}
            </div>
            {field('terms', 'Terms')}
            {document('instrument', 'Document')}
          </fieldset>
        </div>
        <div hidden={step !== 'review'}>
          <fieldset className="min-w-0">
            <legend className="sr-only">Company authority and review</legend>
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <fieldset className="min-w-0">
                <legend className="pb-4 text-base font-medium">Transfer summary</legend>
                <Rows>
                  <Row label={COPY.FROM}>{from?.name}</Row>
                  <Row label={COPY.TO}>{fresh ? draft.name : recipient?.name}</Row>
                  <Row label="Share class">{classLabel}</Row>
                  <Row label="Shares">{shareCount(draft.shares)}</Row>
                  <Row label="Transfer date">{formatDate(draft.companyEventOn)}</Row>
                  <Row label="Signed transfer instrument">{files.instrument?.name}</Row>
                </Rows>
              </fieldset>
              <fieldset className="min-w-0 space-y-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <legend className="pb-4 text-base font-medium">Company authority</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field('approvingDirector', COPY.DIRECTOR)}
                  {field('authorityReference', 'Authority reference')}
                </div>
                {field('reason', 'Reason')}
                {document('authority', 'Document')}
              </fieldset>
            </div>
          </fieldset>
        </div>
      </fieldset>
      {operation && (
        <p className="text-sm text-text-muted">
          The preparation could not be confirmed. Retry to retrieve the original transfer with these details and
          documents.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <FormActions>
        {stepIndex > 0 && (
          <PageAction
            label="Back"
            disabled={busy || blocked || !!operation}
            onClick={() => {
              checks.reset();
              setStep(STEPS[stepIndex - 1].id);
            }}
          />
        )}
        {onCancel && <PageAction label="Cancel" disabled={busy || blocked || !!operation} onClick={onCancel} />}
        <PageAction
          type="submit"
          primary
          label={step === 'review' ? COPY.SUBMIT : 'Continue'}
          busy={busy}
          busyLabel="Preparing transfer…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}

import { useState } from 'react';
import { Field, TextInput, TextArea, FileField } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { FormSteps } from '@components/FormSteps';
import { Row, Rows } from '@components/Ledger';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  FIELD_LIMITS,
  REGISTER_ALLOTMENT_COPY as COPY,
  formatDate,
  formatMoney,
  shareCount,
  type OwnCompanyAppointment,
  type Person,
} from '@ledova/shared';
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

const STEPS = [
  {
    id: 'person',
    label: 'Person and shares',
    fields: ['name', 'residentialAddress', 'shares', 'consideration'],
  },
  {
    id: 'agreement',
    label: 'Agreement and receipt',
    fields: [
      'agreementReference',
      'agreementOn',
      'terms',
      'agreementDocument',
      'receivedAmount',
      'receivedOn',
      'receiptDocument',
    ],
  },
  {
    id: 'review',
    label: 'Company authority and review',
    fields: ['companyEventOn', 'approvingDirector', 'authorityReference', 'reason', 'authorityDocument'],
  },
] as const;

export function AllotmentForm({
  company,
  token,
  classLabel,
  people,
  appointment,
  guard,
  newEffectGuard,
  blocked,
  onRecorded,
  onHeldChange,
  onCancel,
  visible = true,
  initialMember,
}: {
  company: string;
  token: string;
  classLabel: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  newEffectGuard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
  onCancel: () => void;
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
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('person');
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const recipient = people.find((person) => person.member === member);
  const field = (key: Exclude<keyof typeof fields, 'name' | 'residentialAddress'>, label?: string) => (
    <Field
      key={key}
      {...checks.field(key)}
      label={
        label ??
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
      {key === 'terms' ? (
        <TextArea
          rows={3}
          value={fields[key]}
          maxLength={LIMITS[key]}
          onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))}
        />
      ) : (
        <TextInput
          type={key.endsWith('On') ? 'date' : 'text'}
          max={key.endsWith('On') ? today : undefined}
          value={fields[key]}
          maxLength={LIMITS[key]}
          inputMode={INPUT_MODES[key]}
          onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))}
        />
      )}
    </Field>
  );
  const document = (kind: DocumentKind, label?: string) => (
    <FileField
      {...checks.field(`${kind}Document`)}
      label={label ?? COPY.DOCUMENTS[kind]}
      showUploadHint={false}
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
        if (busy || blocked) return;
        if (held) {
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
      <FormSteps label="Investor issue steps" steps={STEPS} current={step} />
      <ErrorSummary {...checks.summary} />
      <fieldset disabled={busy || blocked || held} className="space-y-4">
        <div hidden={step !== 'person'}>
          <fieldset className="space-y-4">
            <legend className="pb-4 text-base font-medium">Person and shares</legend>
            <PersonSelect
              label="Issue to"
              people={people.filter((row) => row.walletless && row.particularsRetained)}
              value={member}
              onChange={setMember}
            />
            {member === 'new' && (
              <div className="grid items-start gap-4 sm:grid-cols-2">
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
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('shares')}
              {field('consideration')}
            </div>
          </fieldset>
        </div>
        <div hidden={step !== 'agreement'}>
          <fieldset className="min-w-0">
            <legend className="sr-only">Agreement and receipt</legend>
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <fieldset className="min-w-0 space-y-4">
                <legend className="pb-4 text-base font-medium">Agreement</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field('agreementReference', 'Reference')}
                  {field('agreementOn', 'Date')}
                </div>
                {field('terms', 'Terms')}
                {document('agreement', 'Document')}
              </fieldset>
              <fieldset className="min-w-0 space-y-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <legend className="pb-4 text-base font-medium">Receipt</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field('receivedAmount', 'Amount received (AUD)')}
                  {field('receivedOn', 'Date')}
                </div>
                {document('receipt', 'Document')}
              </fieldset>
            </div>
          </fieldset>
        </div>
        <div hidden={step !== 'review'}>
          <fieldset className="min-w-0">
            <legend className="sr-only">Company authority and review</legend>
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <fieldset className="min-w-0">
                <legend className="pb-4 text-base font-medium">Issue summary</legend>
                <Rows>
                  <Row label="Issue to">{member === 'new' ? fields.name : recipient?.name}</Row>
                  <Row label="Share class">{classLabel}</Row>
                  <Row label="Shares">{shareCount(fields.shares)}</Row>
                  <Row label="Amount (AUD)">{formatMoney(fields.consideration, 'AUD')}</Row>
                  <Row label="Receipt date">{formatDate(fields.receivedOn)}</Row>
                </Rows>
              </fieldset>
              <fieldset className="min-w-0 space-y-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <legend className="pb-4 text-base font-medium">Company authority</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field('companyEventOn')}
                  {field('approvingDirector')}
                  {field('authorityReference')}
                  {field('reason')}
                </div>
                {document('authority')}
              </fieldset>
            </div>
          </fieldset>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {held && <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>}
      <FormActions>
        {stepIndex > 0 && (
          <PageAction
            label="Back"
            disabled={busy || blocked || held}
            onClick={() => {
              checks.reset();
              setStep(STEPS[stepIndex - 1].id);
            }}
          />
        )}
        <PageAction label="Cancel" disabled={busy || blocked || held} onClick={onCancel} />
        <PageAction
          type="submit"
          primary
          label={step === 'review' ? COPY.SUBMIT : 'Continue'}
          busy={busy}
          busyLabel="Preparing allotment…"
          disabled={blocked}
        />
      </FormActions>
    </form>
  );
}

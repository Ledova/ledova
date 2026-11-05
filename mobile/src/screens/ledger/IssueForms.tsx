import { useState } from 'react';
import { Keyboard, Text, View, type KeyboardTypeOptions } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_GRANT_COPY as GRANT_COPY,
  formatDate,
  formatMoney,
  shareCount,
  useAllotmentForm,
  useErrorSummary,
  useGrantPreparation,
  type AllotmentDocumentKind,
  type GrantDocumentKind,
  type GrantPreparationOptions,
  type OwnCompanyAppointment,
  type Person,
} from '@ledova/shared';
import { Action, Fact, FormActions, MoreToggle, Rows } from '../../components/Ledger';
import { PersonSelect } from '../../components/PersonSelect';
import { Checkbox, Field, FileField } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useLedgerStyles } from './useLedgerStyles';

export const DATE = {
  placeholder: 'YYYY-MM-DD',
  keyboardType: 'numbers-and-punctuation',
  autoCapitalize: 'none',
  autoCorrect: false,
} as const;

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

type Fields = ReturnType<typeof useAllotmentForm>['fields'];
type FieldKey = Exclude<keyof Fields, 'name' | 'residentialAddress'>;

const LABELS: Record<FieldKey, string> = {
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
};

const LIMITS: Partial<Record<FieldKey, number>> = {
  shares: FIELD_LIMITS.REGISTER_SHARES,
  consideration: FIELD_LIMITS.AMOUNT,
  receivedAmount: FIELD_LIMITS.AMOUNT,
  agreementReference: FIELD_LIMITS.REFERENCE,
  terms: FIELD_LIMITS.TERMS,
  approvingDirector: FIELD_LIMITS.DIRECTOR,
  authorityReference: FIELD_LIMITS.REFERENCE,
  reason: FIELD_LIMITS.REASON,
};

const KEYBOARDS: Partial<Record<FieldKey, KeyboardTypeOptions>> = {
  shares: 'number-pad',
  consideration: 'decimal-pad',
  receivedAmount: 'decimal-pad',
};

const GRANT_DOCUMENTS: Record<GrantDocumentKind, string> = {
  authority: GRANT_COPY.AUTHORITY_DOCUMENT,
  terms: GRANT_COPY.TERMS_DOCUMENT,
  acceptance: GRANT_COPY.ACCEPTANCE_DOCUMENT,
};

export function FormNote({ error, note }: { error: string; note?: string }) {
  const styles = useCompanyStyles();
  return (
    <>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!note && <Text style={styles.muted}>{note}</Text>}
    </>
  );
}

export function FormSteps({
  label,
  steps,
  current,
}: {
  label: string;
  steps: readonly { id: string; label: string }[];
  current: string;
}) {
  const look = useThemedStyles((theme) => ({
    steps: { flexDirection: 'row' as const, gap: theme.spacing.smd },
    step: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.smd,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.border.subtle,
    },
    current: { borderBottomColor: theme.colors.brand.mid },
    number: {
      width: 28,
      height: 28,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderRadius: 14,
      backgroundColor: theme.colors.surface.tertiary,
    },
    numberCurrent: { backgroundColor: theme.colors.brand.mid },
    digit: { fontFamily: theme.fontFamily.medium, fontSize: 12, color: theme.colors.text.muted },
    digitCurrent: { color: theme.colors.utility.white },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
    labelCurrent: { color: theme.colors.text.primary },
  }));
  return (
    <View accessibilityLabel={label} style={look.steps}>
      {steps.map((step, index) => {
        const here = step.id === current;
        return (
          <View
            key={step.id}
            accessible
            accessibilityLabel={`${index + 1}. ${step.label}${here ? ', current step' : ''}`}
            style={[look.step, here && look.current]}
          >
            <View style={[look.number, here && look.numberCurrent]}>
              <Text style={[look.digit, here && look.digitCurrent]}>{index + 1}</Text>
            </View>
            <Text style={[look.label, here && look.labelCurrent]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

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
  visible,
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
  onRecorded: (uuid: string) => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
  onCancel: () => void;
  visible: boolean;
  initialMember?: string;
}) {
  const look = useLedgerStyles();
  const form = useAllotmentForm({
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
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const checks = useErrorSummary(form.problems);
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('person');
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const recipient = people.find((person) => person.member === form.member);
  const locked = form.busy || blocked || form.held;
  const change = (key: keyof Fields) => (value: string) => form.setFields((current) => ({ ...current, [key]: value }));
  const field = (key: FieldKey, label = LABELS[key], accessibilityLabel?: string) => {
    const date = key.endsWith('On');
    return (
      <Field
        label={label}
        accessibilityLabel={accessibilityLabel}
        value={form.fields[key]}
        editable={!locked}
        maxLength={LIMITS[key]}
        keyboardType={date ? DATE.keyboardType : KEYBOARDS[key]}
        placeholder={date ? DATE.placeholder : undefined}
        autoCapitalize={date ? DATE.autoCapitalize : undefined}
        autoCorrect={date ? DATE.autoCorrect : undefined}
        multiline={key === 'terms'}
        rows={3}
        error={checks.field(key).error}
        onChange={(value) => change(key)(date ? value.trim() : value)}
      />
    );
  };
  const document = (kind: AllotmentDocumentKind, label = COPY.DOCUMENTS[kind], accessibilityLabel?: string) => (
    <FileField
      label={label}
      value={form.files[kind]}
      accessibilityLabel={accessibilityLabel}
      disabled={locked}
      error={checks.field(`${kind}Document`).error}
      onFile={(file) => form.setFiles((current) => ({ ...current, [kind]: file ?? undefined }))}
    />
  );
  const submit = () => {
    if (form.busy || blocked) return;
    if (form.held) {
      Keyboard.dismiss();
      void form.submit();
      return;
    }
    if (step !== 'review') {
      if (!checks.check(STEPS[stepIndex].fields)) return;
      Keyboard.dismiss();
      setStep(STEPS[stepIndex + 1].id);
      return;
    }
    const invalid = STEPS.find((item) => item.fields.some((key) => form.problems[key]));
    if (invalid) {
      setStep(invalid.id);
      checks.check(invalid.fields);
    } else if (checks.check()) {
      Keyboard.dismiss();
      void form.submit();
    }
  };
  return (
    <View style={[look.form, !visible && look.hidden]}>
      <FormSteps label="Investor issue steps" steps={STEPS} current={step} />
      <View style={[look.fields, step !== 'person' && look.hidden]}>
        <Text accessibilityRole="header" style={look.heading}>
          Person and shares
        </Text>
        <PersonSelect
          label="Issue to"
          people={people.filter((row) => row.walletless && row.particularsRetained)}
          value={form.member}
          onChange={form.setMember}
          allowNew
          disabled={locked}
        />
        {form.member === 'new' && (
          <>
            <Field
              label="Name"
              value={form.fields.name}
              maxLength={FIELD_LIMITS.NAME}
              editable={!locked}
              error={checks.field('name').error}
              onChange={change('name')}
            />
            <Field
              label="Residential address"
              value={form.fields.residentialAddress}
              maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
              multiline
              editable={!locked}
              error={checks.field('residentialAddress').error}
              onChange={change('residentialAddress')}
            />
          </>
        )}
        {field('shares')}
        {field('consideration')}
      </View>
      <View style={[look.fields, step !== 'agreement' && look.hidden]}>
        <Text accessibilityRole="header" style={look.heading}>
          Agreement
        </Text>
        {field('agreementReference', 'Reference', 'Agreement reference')}
        {field('agreementOn', 'Date', 'Agreement date')}
        {field('terms', 'Terms', 'Agreement terms')}
        {document('agreement', 'Document', 'Agreement document')}
        <View style={[look.fields, look.ruled]}>
          <Text accessibilityRole="header" style={look.heading}>
            Receipt
          </Text>
          {field('receivedAmount', 'Amount received (AUD)')}
          {field('receivedOn', 'Date', 'Receipt date')}
          {document('receipt', 'Document', 'Receipt document')}
        </View>
      </View>
      <View style={[look.fields, step !== 'review' && look.hidden]}>
        <Text accessibilityRole="header" style={look.heading}>
          Issue summary
        </Text>
        <Rows>
          <Fact label="Issue to">{(form.member === 'new' ? form.fields.name : recipient?.name) ?? ''}</Fact>
          <Fact label="Share class">{classLabel}</Fact>
          <Fact label="Shares">{shareCount(form.fields.shares)}</Fact>
          <Fact label="Amount (AUD)">{formatMoney(form.fields.consideration, 'AUD')}</Fact>
          <Fact label="Receipt date">{formatDate(form.fields.receivedOn)}</Fact>
        </Rows>
        <View style={[look.fields, look.ruled]}>
          <Text accessibilityRole="header" style={look.heading}>
            Company authority
          </Text>
          {field('companyEventOn')}
          {field('approvingDirector')}
          {field('authorityReference')}
          {field('reason')}
          {document('authority')}
        </View>
      </View>
      <FormNote error={form.error} note={form.held ? COPY.RECOVERY_NOTE : undefined} />
      <FormActions>
        {stepIndex > 0 && (
          <Action
            label="Back"
            disabled={locked}
            onPress={() => {
              checks.reset();
              Keyboard.dismiss();
              setStep(STEPS[stepIndex - 1].id);
            }}
          />
        )}
        <Action
          label="Cancel"
          accessibilityLabel="Cancel (investor issue)"
          disabled={locked}
          onPress={() => {
            Keyboard.dismiss();
            onCancel();
          }}
        />
        <Action
          primary
          label={form.busy ? 'Preparing allotment…' : step === 'review' ? COPY.SUBMIT : 'Continue'}
          disabled={blocked}
          onPress={submit}
        />
      </FormActions>
    </View>
  );
}

export function GrantForm({
  onCancel,
  visible,
  ...options
}: Omit<GrantPreparationOptions, 'newKey' | 'session' | 'visible'> & { onCancel: () => void; visible: boolean }) {
  const look = useLedgerStyles();
  const { award, people, blocked, canPrepare = true } = options;
  const model = useGrantPreparation({ ...options, newKey: randomUUID, session: orderSubmissionSession })!;
  const checks = useErrorSummary(model.problems);
  const [awardDetails, setAwardDetails] = useState(false);
  const locked = model.busy || blocked || model.held || !canPrepare;
  const detailsError = !!checks.field('termsOn').error || !!checks.field('terms').error;
  const detailsOpen = awardDetails || detailsError;
  const document = (kind: GrantDocumentKind) => (
    <FileField
      label={GRANT_DOCUMENTS[kind]}
      value={model.files[kind]}
      disabled={locked}
      error={checks.field(`${kind}Document`).error}
      onFile={(file) => model.setFiles((current) => ({ ...current, [kind]: file ?? undefined }))}
    />
  );
  return (
    <View style={[look.form, !visible && look.hidden]}>
      <View style={look.fields}>
        <Text accessibilityRole="header" style={look.heading}>
          Issue details
        </Text>
        {award ? (
          <View style={look.terms}>
            <Text style={look.name}>{model.recipientName}</Text>
            <Text style={look.muted}>{shareCount(award.availableShares, 'vested')} available to issue</Text>
          </View>
        ) : (
          <PersonSelect
            label="Issue to"
            people={people.filter((row) => row.walletless && row.particularsRetained)}
            value={model.member}
            onChange={model.setMember}
            allowNew
            disabled={locked}
          />
        )}
        {!award && model.member === 'new' && (
          <>
            <Field
              label="Name"
              value={model.name}
              maxLength={FIELD_LIMITS.NAME}
              editable={!locked}
              error={checks.field('name').error}
              onChange={model.setName}
            />
            <Field
              label="Residential address"
              value={model.address}
              maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
              multiline
              editable={!locked}
              error={checks.field('address').error}
              onChange={model.setAddress}
            />
          </>
        )}
        <Field
          label={GRANT_COPY.SHARES}
          value={model.shares}
          keyboardType="number-pad"
          maxLength={FIELD_LIMITS.REGISTER_SHARES}
          editable={!locked}
          error={checks.field('shares').error}
          onChange={(shares) => model.setShares(shares.trim())}
        />
        <Field
          label={GRANT_COPY.COMPANY_EVENT_ON}
          value={model.companyEventOn}
          {...DATE}
          editable={!locked}
          error={checks.field('companyEventOn').error}
          onChange={(date) => model.setCompanyEventOn(date.trim())}
        />
        {award ? (
          <>
            <MoreToggle
              open={detailsOpen}
              onToggle={() => {
                if (!detailsError) setAwardDetails((current) => !current);
              }}
            >
              {detailsOpen ? 'Hide award record details' : 'Show award record details'}
            </MoreToggle>
            <View style={[look.fields, !detailsOpen && look.hidden]}>
              <Text style={look.muted}>{model.recipientAddress}</Text>
              <Field
                label={GRANT_COPY.TERMS_ON}
                value={model.retainedDate}
                editable={false}
                error={checks.field('termsOn').error}
                onChange={() => undefined}
              />
              <Field
                label={GRANT_COPY.TERMS}
                value={model.retainedSummary}
                multiline
                rows={3}
                editable={false}
                error={checks.field('terms').error}
                onChange={() => undefined}
              />
            </View>
          </>
        ) : (
          <>
            <Field
              label={GRANT_COPY.TERMS_ON}
              value={model.retainedDate}
              {...DATE}
              editable={!locked}
              error={checks.field('termsOn').error}
              onChange={(date) => model.setTermsOn(date.trim())}
            />
            <Field
              label={GRANT_COPY.TERMS}
              value={model.terms}
              multiline
              rows={3}
              maxLength={FIELD_LIMITS.TERMS}
              editable={!locked}
              error={checks.field('terms').error}
              onChange={model.setTerms}
            />
            {document('terms')}
          </>
        )}
      </View>
      <View style={[look.fields, look.ruled]}>
        <Text accessibilityRole="header" style={look.heading}>
          Company authority
        </Text>
        <Field
          label={GRANT_COPY.DIRECTOR}
          value={model.approvingDirector}
          maxLength={FIELD_LIMITS.DIRECTOR}
          editable={!locked}
          error={checks.field('director').error}
          onChange={model.setApprovingDirector}
        />
        <Field
          label={GRANT_COPY.AUTHORITY_REFERENCE}
          value={model.authorityReference}
          maxLength={FIELD_LIMITS.REFERENCE}
          editable={!locked}
          error={checks.field('reference').error}
          onChange={model.setAuthorityReference}
        />
        <Field
          label={GRANT_COPY.REASON}
          value={model.reason}
          multiline
          rows={3}
          maxLength={FIELD_LIMITS.REASON}
          editable={!locked}
          error={checks.field('reason').error}
          onChange={model.setReason}
        />
        {document('authority')}
        <Checkbox
          label={GRANT_COPY.ACCEPTANCE_REQUIRED}
          checked={model.acceptanceRequired}
          disabled={locked}
          error={null}
          onChange={model.setAcceptanceRequired}
        />
        {model.documentKinds.includes('acceptance') && document('acceptance')}
      </View>
      <FormNote
        error={model.error}
        note={
          model.held
            ? 'Recover the original preparation before starting another. Preparation creates no issued shares.'
            : undefined
        }
      />
      <FormActions>
        <Action
          label="Cancel"
          accessibilityLabel="Cancel (non-paid issue)"
          disabled={model.busy || model.held}
          onPress={() => {
            Keyboard.dismiss();
            onCancel();
          }}
        />
        <Action
          primary
          label={
            model.busy
              ? 'Preparing grant…'
              : model.held
                ? 'Recover original grant preparation'
                : award
                  ? 'Prepare vested share issue'
                  : GRANT_COPY.SUBMIT
          }
          disabled={blocked || (!model.held && !canPrepare)}
          onPress={() => {
            if (!model.held && !checks.check()) return;
            Keyboard.dismiss();
            void model.submit();
          }}
        />
      </FormActions>
    </View>
  );
}

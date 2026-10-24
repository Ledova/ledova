import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  NEW_PERSON_PROBLEMS,
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_ALLOTMENT_UNMET_COPY,
  allotmentAud,
  apiErrorSentence,
  createUserFriendlyError,
  failureSentence,
  failureStatus,
  formatDate,
  formatMoney,
  getRegisterAllotment,
  hasProblems,
  isPreparedRegisterAllotment,
  personRequest,
  prepareRegisterAllotment,
  refusalSentence,
  shareCount,
  useErrorSummary,
  type OwnCompanyAppointment,
  type Person,
  type RegisterAllotmentPreparation,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { ErrorSummary } from '../../components/ErrorSummary';
import { FormSteps } from '../../components/FormSteps';
import { apiClient } from '../../services/apiClient';
import { EvidencePicker, Field, isoDay, utcToday } from '../../components/register/RegisterFields';
import { PersonFields, PersonSelect } from '../../components/register/PersonPicker';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';

type DocumentKind = 'authority' | 'agreement' | 'receipt';

const STEPS = [
  { id: 'person', label: 'Person and shares', fields: ['name', 'residentialAddress', 'shares', 'consideration'] },
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

const FAILED = COPY.PREPARATION_RECEIPT_FAILED;

export function AllotmentForm({
  company,
  token,
  epoch,
  classLabel,
  people,
  appointment,
  guard,
  newEffectGuard,
  blocked,
  initialMember,
  onRecorded,
  onHeldChange,
  onCancel,
  visible = true,
}: {
  company: string;
  token: string;
  epoch: number;
  classLabel: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  newEffectGuard: () => void;
  blocked: boolean;
  initialMember?: string;
  onRecorded: (uuid: string) => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
  onCancel: () => void;
  visible?: boolean;
}) {
  const styles = useCompanyStyles();
  const today = utcToday();
  const [memberId] = useState(() => Crypto.randomUUID());
  const [member, setMember] = useState(() =>
    people.some((person) => person.member === initialMember && person.walletless && person.particularsRetained)
      ? initialMember!
      : 'new',
  );
  const [fields, setFields] = useState({
    name: '',
    residentialAddress: '',
    shares: '',
    companyEventOn: '',
    consideration: '',
    receivedAmount: '',
    agreementReference: '',
    agreementOn: today,
    receivedOn: today,
    terms: '',
    approvingDirector: '',
    authorityReference: '',
    reason: '',
  });
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('person');
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const authority = useRegisterEvidence(company, 'authority');
  const agreement = useRegisterEvidence(company, 'supporting');
  const receipt = useRegisterEvidence(company, 'supporting');
  const documents = { authority, agreement, receipt };
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || authority.busy || agreement.busy || receipt.busy;
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const unavailable = useRef(blocked || !visible);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
  }, [blocked, visible]);
  const live = useRef(true);
  const pending = useRef(false);
  const operation = useRef<{ request: RegisterAllotmentPreparation; confirmed: boolean; uncertain: boolean } | null>(
    null,
  );
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    onHeldChange(busy || held);
  }, [busy, held, onHeldChange]);
  useEffect(() => () => onHeldChange(false), [onHeldChange]);
  const check = () => {
    guard();
    if (unavailable.current)
      throw createUserFriendlyError('Refresh company access and the current records before continuing.');
    if (!live.current) throw createUserFriendlyError('This allotment form is closed.');
  };
  const beforeWrite = () => {
    check();
    newEffectGuard();
  };
  const consideration = allotmentAud(fields.consideration);
  const received = allotmentAud(fields.receivedAmount);
  const past = (date: string) => !isoDay(date.trim()) || date.trim() > today;
  const problems = {
    name: member === 'new' && !fields.name.trim() && NEW_PERSON_PROBLEMS.NAME,
    residentialAddress: member === 'new' && !fields.residentialAddress.trim() && NEW_PERSON_PROBLEMS.ADDRESS,
    shares:
      (!/^[1-9]\d*$/.test(fields.shares) || BigInt(fields.shares) >= 2n ** 256n) &&
      'Enter a positive whole number of shares.',
    consideration: !consideration && 'Enter the positive AUD consideration, with at most two decimal places.',
    agreementReference: !fields.agreementReference.trim() && 'Give the agreement reference.',
    agreementOn: past(fields.agreementOn) && 'Enter the agreement date as YYYY-MM-DD, no later than today (UTC).',
    terms: !fields.terms.trim() && 'Give the agreement terms.',
    agreementDocument: !agreement.name && 'Choose the agreement evidence.',
    receivedAmount:
      !!consideration &&
      received !== consideration &&
      'The company-reported receipt must equal the full consideration.',
    receivedOn: past(fields.receivedOn) && 'Enter the receipt date as YYYY-MM-DD, no later than today (UTC).',
    receiptDocument: !receipt.name && 'Choose the receipt evidence.',
    companyEventOn:
      past(fields.companyEventOn) && 'Enter the company issue date as YYYY-MM-DD, no later than today (UTC).',
    approvingDirector: !fields.approvingDirector.trim() && 'Name the approving director.',
    authorityReference: !fields.authorityReference.trim() && 'Give the authority reference.',
    reason: !fields.reason.trim() && 'Give the reason.',
    authorityDocument: !authority.name && 'Choose the authority evidence.',
  };
  const checks = useErrorSummary(problems);
  const pick = async (kind: DocumentKind) => {
    try {
      check();
      await documents[kind].pick();
      check();
    } catch (cause) {
      try {
        check();
      } catch {
        return;
      }
      setError(failureSentence(cause, 'The evidence could not be selected.'));
    }
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && hasProblems(problems))) return;
    pending.current = true;
    setSubmitting(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        const retainedAuthority = await authority.upload(appointment.uuid, beforeWrite);
        const retainedAgreement = await agreement.upload(appointment.uuid, beforeWrite);
        const retainedReceipt = await receipt.upload(appointment.uuid, beforeWrite);
        command = {
          request: {
            operationId: Crypto.randomUUID(),
            appointment: appointment.uuid,
            tokenId: token,
            ...personRequest(member, people, memberId, fields.name, fields.residentialAddress),
            shares: fields.shares,
            companyEventOn: fields.companyEventOn.trim(),
            consideration: consideration!,
            receivedAmount: received!,
            currency: 'AUD',
            agreementReference: fields.agreementReference.trim(),
            agreementOn: fields.agreementOn.trim(),
            terms: fields.terms.trim(),
            receivedOn: fields.receivedOn.trim(),
            approvingDirector: fields.approvingDirector.trim(),
            authorityReference: fields.authorityReference.trim(),
            reason: fields.reason.trim(),
            authorityEvidence: retainedAuthority.uuid,
            agreementEvidence: retainedAgreement.uuid,
            receiptEvidence: retainedReceipt.uuid,
          },
          confirmed: false,
          uncertain: false,
        };
        operation.current = command;
        setHeld(true);
      }
      const lookup = async () => {
        try {
          check();
          const { data } = await getRegisterAllotment(apiClient, command!.request.operationId, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isPreparedRegisterAllotment(data, command!.request, company)) throw createUserFriendlyError(FAILED);
          return true;
        } catch (cause) {
          check();
          if (failureStatus(cause) !== 404) throw cause;
          return false;
        }
      };
      let absent = false;
      if (command.uncertain && !command.confirmed) {
        command.confirmed = await lookup();
        absent = !command.confirmed;
      }
      if (!command.confirmed) {
        try {
          const writeGuard = command.uncertain ? check : beforeWrite;
          writeGuard();
          const { data } = await prepareRegisterAllotment(apiClient, command.request, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: writeGuard,
          });
          check();
          if (!isPreparedRegisterAllotment(data, command.request, company)) throw createUserFriendlyError(FAILED);
          command.confirmed = true;
        } catch (cause) {
          const status = failureStatus(cause);
          if (!absent || !status || status < 400 || status >= 500) throw cause;
          command.confirmed = await lookup();
          if (!command.confirmed) {
            operation.current = null;
            setHeld(false);
            setError(
              'The original allotment was not recorded and the request was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
      }
      await onRecorded(command.request.operationId);
      operation.current = null;
      if (live.current) setHeld(false);
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          if (live.current) setHeld(false);
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(refusalSentence(cause, REGISTER_ALLOTMENT_UNMET_COPY) ?? apiErrorSentence(cause, FAILED, FAILED));
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  const press = () => {
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
  };
  const editable = !busy && !blocked && !held;
  const set = (key: keyof typeof fields) => (value: string) => setFields((current) => ({ ...current, [key]: value }));
  const recipient = people.find((person) => person.member === member);
  const evidence = (kind: DocumentKind, title: string, noun: string) => (
    <EvidencePicker
      title={title}
      noun={noun}
      evidence={documents[kind]}
      error={checks.field(`${kind}Document`).error}
      disabled={!editable}
      onPick={() => void pick(kind)}
    />
  );
  if (!visible) return null;
  return (
    <View style={styles.group}>
      <FormSteps label="Investor issue steps" steps={STEPS} current={step} />
      <View style={step === 'person' ? styles.group : HIDDEN}>
        <Text accessibilityRole="header" style={styles.heading}>
          Person and shares
        </Text>
        <PersonSelect
          label="Issue to"
          people={people.filter((row) => row.walletless && row.particularsRetained)}
          value={member}
          onChange={setMember}
          disabled={!editable}
        />
        {member === 'new' && (
          <PersonFields
            name={fields.name}
            residentialAddress={fields.residentialAddress}
            onName={set('name')}
            onResidentialAddress={set('residentialAddress')}
            editable={editable}
            nameError={checks.field('name').error}
            addressError={checks.field('residentialAddress').error}
          />
        )}
        <Field
          label={COPY.SHARES}
          value={fields.shares}
          editable={editable}
          keyboardType="number-pad"
          maxLength={78}
          error={checks.field('shares').error}
          onChange={set('shares')}
        />
        <Field
          label={COPY.CONSIDERATION}
          value={fields.consideration}
          editable={editable}
          keyboardType="decimal-pad"
          maxLength={255}
          error={checks.field('consideration').error}
          onChange={set('consideration')}
        />
      </View>
      <View style={step === 'agreement' ? styles.group : HIDDEN}>
        <Text accessibilityRole="header" style={styles.heading}>
          Agreement
        </Text>
        <Field
          label="Reference"
          accessibilityLabel={COPY.AGREEMENT_REFERENCE}
          value={fields.agreementReference}
          editable={editable}
          maxLength={255}
          error={checks.field('agreementReference').error}
          onChange={set('agreementReference')}
        />
        <Field
          label="Date (YYYY-MM-DD)"
          accessibilityLabel={COPY.AGREEMENT_ON}
          value={fields.agreementOn}
          editable={editable}
          maxLength={10}
          error={checks.field('agreementOn').error}
          onChange={set('agreementOn')}
        />
        <Field
          label="Terms"
          accessibilityLabel={COPY.TERMS}
          value={fields.terms}
          editable={editable}
          multiline
          maxLength={1000}
          error={checks.field('terms').error}
          onChange={set('terms')}
        />
        {evidence('agreement', 'Document', 'agreement document')}
        <Text accessibilityRole="header" style={styles.heading}>
          Receipt
        </Text>
        <Field
          label="Amount received (AUD)"
          accessibilityLabel={COPY.RECEIVED_AMOUNT}
          value={fields.receivedAmount}
          editable={editable}
          keyboardType="decimal-pad"
          maxLength={255}
          error={checks.field('receivedAmount').error}
          onChange={set('receivedAmount')}
        />
        <Field
          label="Date (YYYY-MM-DD)"
          accessibilityLabel={COPY.RECEIVED_ON}
          value={fields.receivedOn}
          editable={editable}
          maxLength={10}
          error={checks.field('receivedOn').error}
          onChange={set('receivedOn')}
        />
        {evidence('receipt', 'Document', 'receipt evidence')}
      </View>
      <View style={step === 'review' ? styles.group : HIDDEN}>
        <Text accessibilityRole="header" style={styles.heading}>
          Issue summary
        </Text>
        <Rows>
          <Row label="Issue to">{member === 'new' ? fields.name.trim() : recipient?.name}</Row>
          <Row label="Share class">{classLabel}</Row>
          <Row label="Shares">{shareCount(fields.shares || '0')}</Row>
          <Row label="Amount (AUD)">{formatMoney(fields.consideration, 'AUD')}</Row>
          <Row label="Receipt date">{formatDate(fields.receivedOn)}</Row>
        </Rows>
        <Text accessibilityRole="header" style={styles.heading}>
          Company authority
        </Text>
        <Field
          label={`${COPY.COMPANY_EVENT_ON} (YYYY-MM-DD)`}
          accessibilityLabel={COPY.COMPANY_EVENT_ON}
          value={fields.companyEventOn}
          editable={editable}
          maxLength={10}
          error={checks.field('companyEventOn').error}
          onChange={set('companyEventOn')}
        />
        <Field
          label={COPY.DIRECTOR}
          value={fields.approvingDirector}
          editable={editable}
          maxLength={255}
          error={checks.field('approvingDirector').error}
          onChange={set('approvingDirector')}
        />
        <Field
          label={COPY.AUTHORITY_REFERENCE}
          value={fields.authorityReference}
          editable={editable}
          maxLength={255}
          error={checks.field('authorityReference').error}
          onChange={set('authorityReference')}
        />
        <Field
          label={COPY.REASON}
          value={fields.reason}
          editable={editable}
          multiline
          maxLength={1000}
          error={checks.field('reason').error}
          onChange={set('reason')}
        />
        {evidence('authority', COPY.DOCUMENTS.authority, 'authority document')}
      </View>
      <ErrorSummary {...checks.summary} />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {held && <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>}
      <View style={styles.actions}>
        {stepIndex > 0 && (
          <Action
            label="Back"
            disabled={!editable}
            onPress={() => {
              checks.reset();
              setStep(STEPS[stepIndex - 1].id);
            }}
          />
        )}
        <Action label="Cancel" disabled={!editable} onPress={onCancel} />
        <Action
          label={submitting ? 'Preparing allotment…' : step === 'review' ? COPY.SUBMIT : 'Continue'}
          primary
          disabled={busy || blocked}
          onPress={press}
        />
      </View>
    </View>
  );
}

const HIDDEN = { display: 'none' } as const;

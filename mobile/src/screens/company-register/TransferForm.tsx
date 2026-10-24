import { useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_UNMET_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureSentence,
  failureStatus,
  formatDate,
  hasProblems,
  isPreparedRegisterTransfer,
  prepareRegisterTransfer,
  refusalSentence,
  shareCount,
  useErrorSummary,
  type OwnCompanyAppointment,
  type Person,
  type RegisterTransferPreparation,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { ErrorSummary } from '../../components/ErrorSummary';
import { FormSteps } from '../../components/FormSteps';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
import { EvidencePicker, Field, isoDay, utcToday } from '../../components/register/RegisterFields';
import { PersonFields, PersonSelect } from '../../components/register/PersonPicker';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { transfersKey } from '../../hooks/useCompanyRegister';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';

const HIDDEN = { display: 'none' } as const;

type DocumentKind = 'authority' | 'instrument';

const STEPS = [
  {
    id: 'people',
    label: 'People and shares',
    fields: ['fromMember', 'toMember', 'name', 'residentialAddress', 'shares', 'companyEventOn'],
  },
  { id: 'documents', label: 'Transfer documents', fields: ['signedOn', 'lodgedOn', 'terms', 'instrumentDocument'] },
  {
    id: 'review',
    label: 'Company authority and review',
    fields: ['approvingDirector', 'authorityReference', 'reason', 'authorityDocument'],
  },
] as const;

const FAILED = 'The preparation response could not be confirmed. Retry with the same details.';

function inClass(person: Person) {
  return person.onRegister === false ? '' : `${shareCount(person.currentShares)} in this class`;
}

export function TransferForm({
  company,
  token,
  epoch,
  classLabel,
  people,
  appointment,
  current,
  blocked,
  initialFrom,
  onRefused,
  onPrepared,
  onCancel,
}: {
  company: string;
  token: string;
  epoch: number;
  classLabel: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  current: () => OwnCompanyAppointment | undefined;
  blocked: boolean;
  initialFrom?: string;
  onRefused: () => Promise<unknown>;
  onPrepared: () => void;
  onCancel: () => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const today = utcToday();
  const eligible = people.filter((person) => person.walletless);
  const [draft, setDraft] = useState(() => ({
    fromMember: eligible.some(
      (person) => person.member === initialFrom && person.particularsRetained && BigInt(person.currentShares) > 0n,
    )
      ? initialFrom!
      : '',
    toMember: '',
    name: '',
    residentialAddress: '',
    shares: '',
    companyEventOn: '',
    signedOn: today,
    lodgedOn: today,
    terms: '',
    approvingDirector: '',
    authorityReference: '',
    reason: '',
  }));
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('people');
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const authority = useRegisterEvidence(company, 'authority');
  const instrument = useRegisterEvidence(company, 'supporting');
  const documents = { authority, instrument };
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<{
    request: RegisterTransferPreparation;
    newParticulars: boolean;
  } | null>(null);
  const busy = submitting || authority.busy || instrument.busy;
  const live = useRef(true);
  const pending = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = () => {
    assertSessionEpoch(epoch);
    if (!live.current) throw createUserFriendlyError('This transfer form is closed. Reopen it before continuing.');
  };
  const beforeWrite = () => {
    check();
    if (current()?.uuid !== appointment.uuid)
      throw createUserFriendlyError('Refresh the register and your preparation appointment.');
  };
  const change = (key: keyof typeof draft) => (value: string) => {
    setError('');
    setDraft((previous) => ({ ...previous, [key]: value }));
  };
  const from = eligible.find(
    (person) => person.member === draft.fromMember && person.particularsRetained && BigInt(person.currentShares) > 0n,
  );
  const recipient = eligible.find((person) => person.member === draft.toMember);
  const fresh = operation?.newParticulars ?? (!!recipient && !recipient.particularsRetained);
  const past = (date: string) => !isoDay(date.trim()) || date.trim() > today;
  const problems = {
    fromMember: !from && 'Select an identified transferor holding shares in this class.',
    toMember: (!recipient || draft.toMember === draft.fromMember) && 'Select a different existing company person.',
    name: fresh && !draft.name.trim() && 'Give the recipient’s name from the signed instrument.',
    residentialAddress:
      fresh &&
      !draft.residentialAddress.trim() &&
      'Give the recipient’s residential address from the signed instrument.',
    shares:
      (!/^[1-9]\d*$/.test(draft.shares.trim()) ||
        (!!from && BigInt(draft.shares.trim()) > BigInt(from.currentShares))) &&
      'Enter a positive whole share quantity within the transferor’s holding.',
    companyEventOn:
      past(draft.companyEventOn) && 'Enter the company transfer date as YYYY-MM-DD, no later than today (UTC).',
    signedOn: past(draft.signedOn) && 'Enter the signing date as YYYY-MM-DD, no later than today (UTC).',
    lodgedOn: past(draft.lodgedOn)
      ? 'Enter the lodgement date as YYYY-MM-DD, no later than today (UTC).'
      : !past(draft.signedOn) &&
        draft.signedOn.trim() > draft.lodgedOn.trim() &&
        'Enter a lodgement date on or after the signing date.',
    terms: !draft.terms.trim() && 'Give the non-paid terms.',
    approvingDirector: !draft.approvingDirector.trim() && 'Name the approving director.',
    authorityReference: !draft.authorityReference.trim() && 'Give the authority reference.',
    reason: !draft.reason.trim() && 'Give the reason.',
    authorityDocument: !authority.name && 'Choose the director authority.',
    instrumentDocument: !instrument.name && 'Choose the signed transfer instrument.',
  };
  const checks = useErrorSummary(problems);
  const pick = async (kind: DocumentKind) => {
    setError('');
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
      setError(failureSentence(cause, 'The document could not be selected. Try again.'));
    }
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation && hasProblems(problems))) return;
    pending.current = true;
    setSubmitting(true);
    setError('');
    try {
      check();
      let retained = operation;
      if (!retained) {
        const authorityEvidence = await authority.upload(appointment.uuid, beforeWrite);
        const instrumentEvidence = await instrument.upload(appointment.uuid, beforeWrite);
        retained = {
          request: {
            operationId: Crypto.randomUUID(),
            appointment: appointment.uuid,
            tokenId: token,
            fromMember: draft.fromMember,
            toMember: draft.toMember,
            newMember: false,
            ...(fresh ? { name: draft.name.trim(), residentialAddress: draft.residentialAddress.trim() } : {}),
            shares: draft.shares.trim(),
            companyEventOn: draft.companyEventOn.trim(),
            signedOn: draft.signedOn.trim(),
            lodgedOn: draft.lodgedOn.trim(),
            terms: draft.terms.trim(),
            approvingDirector: draft.approvingDirector.trim(),
            authorityReference: draft.authorityReference.trim(),
            reason: draft.reason.trim(),
            authorityEvidence: authorityEvidence.uuid,
            instrumentEvidence: instrumentEvidence.uuid,
          },
          newParticulars: fresh,
        };
        setOperation(retained);
      }
      const { request, newParticulars } = retained;
      check();
      const { data } = await prepareRegisterTransfer(apiClient, request, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: check,
      });
      check();
      if (!isPreparedRegisterTransfer(data, request, newParticulars))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      setOperation(null);
      await client.invalidateQueries({ queryKey: transfersKey(epoch, token) });
      check();
      onPrepared();
    } catch (cause) {
      const status = failureStatus(cause);
      if (status && status < 500) setOperation(null);
      try {
        check();
      } catch {
        return;
      }
      setError(refusalSentence(cause, REGISTER_TRANSFER_UNMET_COPY) ?? apiErrorSentence(cause, FAILED, FAILED));
      if (status === 400 || status === 404 || status === 409) await onRefused();
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  const press = () => {
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
  };
  const editable = !busy && !blocked && !operation;
  const evidence = (kind: DocumentKind, noun: string) => (
    <EvidencePicker
      title="Document"
      noun={noun}
      evidence={documents[kind]}
      error={checks.field(`${kind}Document`).error}
      disabled={!editable}
      onPick={() => void pick(kind)}
    />
  );
  return (
    <View style={styles.group}>
      <FormSteps steps={STEPS} current={step} />
      <View style={step === 'people' ? styles.group : HIDDEN}>
        <Text accessibilityRole="header" style={styles.heading}>
          People and shares
        </Text>
        <PersonSelect
          label={COPY.FROM}
          people={eligible.filter((person) => person.particularsRetained && BigInt(person.currentShares) > 0n)}
          value={draft.fromMember}
          onChange={change('fromMember')}
          allowNew={false}
          context={inClass}
          disabled={!editable}
          error={checks.field('fromMember').error}
        />
        <PersonSelect
          label={COPY.TO}
          people={eligible.filter((person) => person.member !== draft.fromMember)}
          value={draft.toMember}
          onChange={change('toMember')}
          allowNew={false}
          context={inClass}
          disabled={!editable}
          error={checks.field('toMember').error}
        />
        {fresh && (
          <PersonFields
            name={draft.name}
            residentialAddress={draft.residentialAddress}
            onName={change('name')}
            onResidentialAddress={change('residentialAddress')}
            editable={editable}
            nameError={checks.field('name').error}
            addressError={checks.field('residentialAddress').error}
          />
        )}
        {!!recipient?.lastCeasedOn && (
          <Text style={styles.muted}>
            Last ceased in this class: {formatDate(recipient.lastCeasedOn)}. The same member ID is retained on return.
          </Text>
        )}
        {fresh && (
          <Text style={styles.muted}>
            This member’s particulars passed the retention period. Supply their current particulars from the signed
            instrument, keeping their existing member ID.
          </Text>
        )}
        <Field
          label={COPY.SHARES}
          value={draft.shares}
          editable={editable}
          keyboardType="number-pad"
          maxLength={78}
          error={checks.field('shares').error}
          onChange={change('shares')}
        />
        <Field
          label={`${COPY.COMPANY_EVENT_ON} (YYYY-MM-DD)`}
          accessibilityLabel={COPY.COMPANY_EVENT_ON}
          value={draft.companyEventOn}
          editable={editable}
          maxLength={10}
          error={checks.field('companyEventOn').error}
          onChange={change('companyEventOn')}
        />
      </View>
      <View style={step === 'documents' ? styles.group : HIDDEN}>
        <Text accessibilityRole="header" style={styles.heading}>
          Transfer documents
        </Text>
        <Field
          label="Signed on (YYYY-MM-DD)"
          accessibilityLabel={COPY.SIGNED_ON}
          value={draft.signedOn}
          editable={editable}
          maxLength={10}
          error={checks.field('signedOn').error}
          onChange={change('signedOn')}
        />
        <Field
          label="Lodged with company on (YYYY-MM-DD)"
          accessibilityLabel={COPY.LODGED_ON}
          value={draft.lodgedOn}
          editable={editable}
          maxLength={10}
          error={checks.field('lodgedOn').error}
          onChange={change('lodgedOn')}
        />
        <Field
          label="Terms"
          accessibilityLabel={COPY.TERMS}
          value={draft.terms}
          editable={editable}
          multiline
          maxLength={1000}
          error={checks.field('terms').error}
          onChange={change('terms')}
        />
        {evidence('instrument', 'signed transfer instrument')}
      </View>
      <View style={step === 'review' ? styles.group : HIDDEN}>
        <Text accessibilityRole="header" style={styles.heading}>
          Transfer summary
        </Text>
        <Rows>
          <Row label={COPY.FROM}>{from?.name}</Row>
          <Row label={COPY.TO}>{fresh ? draft.name.trim() : recipient?.name}</Row>
          <Row label="Share class">{classLabel}</Row>
          <Row label="Shares">{shareCount(draft.shares.trim() || '0')}</Row>
          <Row label="Transfer date">{formatDate(draft.companyEventOn.trim())}</Row>
          <Row label="Signed transfer instrument">{instrument.name}</Row>
        </Rows>
        <Text accessibilityRole="header" style={styles.heading}>
          Company authority
        </Text>
        <Field
          label={COPY.DIRECTOR}
          value={draft.approvingDirector}
          editable={editable}
          maxLength={255}
          error={checks.field('approvingDirector').error}
          onChange={change('approvingDirector')}
        />
        <Field
          label="Authority reference"
          accessibilityLabel={COPY.AUTHORITY_REFERENCE}
          value={draft.authorityReference}
          editable={editable}
          maxLength={255}
          error={checks.field('authorityReference').error}
          onChange={change('authorityReference')}
        />
        <Field
          label="Reason"
          accessibilityLabel={COPY.REASON}
          value={draft.reason}
          editable={editable}
          multiline
          maxLength={1000}
          error={checks.field('reason').error}
          onChange={change('reason')}
        />
        {evidence('authority', 'authority document')}
      </View>
      <ErrorSummary {...checks.summary} />
      {!!operation && (
        <Text style={styles.muted}>
          The preparation could not be confirmed. Retry to retrieve the original transfer with these details and
          documents.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
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
          label={submitting ? 'Preparing transfer…' : step === 'review' || operation ? COPY.SUBMIT : 'Continue'}
          primary
          disabled={busy || blocked}
          onPress={press}
        />
      </View>
    </View>
  );
}

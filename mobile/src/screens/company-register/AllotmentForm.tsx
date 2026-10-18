import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  allotmentAud,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getRegisterAllotment,
  getErrorMessage,
  isPreparedRegisterAllotment,
  prepareRegisterAllotment,
  type OwnCompanyAppointment,
  type RegisterAllotmentPreparation,
  type RegisterTransferMember,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { EvidencePicker, Field, isoDay, utcToday } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';

type DocumentKind = 'authority' | 'agreement' | 'receipt';

export function AllotmentForm({
  company,
  token,
  epoch,
  members,
  appointment,
  guard,
  newEffectGuard,
  blocked,
  onRecorded,
  onHeldChange,
  visible = true,
}: {
  company: string;
  token: string;
  epoch: number;
  members: RegisterTransferMember[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  newEffectGuard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
  visible?: boolean;
}) {
  const styles = useCompanyStyles();
  const today = utcToday();
  const [memberId] = useState(() => Crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [fields, setFields] = useState({
    name: '',
    residentialAddress: '',
    shares: '',
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
  const authority = useRegisterEvidence(company, 'authority');
  const agreement = useRegisterEvidence(company, 'supporting');
  const receipt = useRegisterEvidence(company, 'supporting');
  const documents = { authority, agreement, receipt };
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || authority.busy || agreement.busy || receipt.busy;
  const [held, setHeld] = useState(false);
  const [error, setError] = useState<string | null>('');
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
  const problem =
    member === 'new' && (!fields.name.trim() || !fields.residentialAddress.trim())
      ? 'Give the investor’s name and residential address.'
      : !/^[1-9]\d*$/.test(fields.shares) || BigInt(fields.shares) >= 2n ** 256n
        ? 'Enter a positive whole number of shares.'
        : !consideration || received !== consideration
          ? 'The company-reported receipt must equal the full positive AUD consideration, with at most two decimal places.'
          : [fields.agreementOn, fields.receivedOn].some((date) => !isoDay(date) || date > today)
            ? 'Agreement and receipt dates must be today (UTC) or earlier.'
            : !fields.agreementReference.trim() ||
                !fields.terms.trim() ||
                !fields.approvingDirector.trim() ||
                !fields.authorityReference.trim() ||
                !fields.reason.trim()
              ? 'Give the external agreement, approving director, company authority and reason.'
              : (['authority', 'agreement', 'receipt'] as const).some((kind) => !documents[kind].name)
                ? 'Choose the authority, agreement and receipt evidence.'
                : null;
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
      setError(getErrorMessage(cause, 'The evidence could not be selected.'));
    }
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && problem)) return;
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
            member: member === 'new' ? memberId : member,
            newMember: member === 'new',
            ...(member === 'new'
              ? { name: fields.name.trim(), residentialAddress: fields.residentialAddress.trim() }
              : {}),
            shares: fields.shares,
            consideration: consideration!,
            receivedAmount: received!,
            currency: 'AUD',
            agreementReference: fields.agreementReference.trim(),
            agreementOn: fields.agreementOn,
            terms: fields.terms.trim(),
            receivedOn: fields.receivedOn,
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
        onHeldChange(true);
      }
      const lookup = async () => {
        try {
          check();
          const { data } = await getRegisterAllotment(apiClient, command!.request.operationId, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isPreparedRegisterAllotment(data, command!.request, company))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
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
          if (!isPreparedRegisterAllotment(data, command.request, company))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
          command.confirmed = true;
        } catch (cause) {
          const status = failureStatus(cause);
          if (!absent || !status || status < 400 || status >= 500) throw cause;
          command.confirmed = await lookup();
          if (!command.confirmed) {
            operation.current = null;
            setHeld(false);
            onHeldChange?.(false);
            setError(
              'The original allotment was not recorded and the request was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
      }
      await onRecorded();
      operation.current = null;
      if (live.current) {
        setHeld(false);
        onHeldChange(false);
      }
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          if (live.current) {
            setHeld(false);
            onHeldChange(false);
          }
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, COPY.PREPARATION_RECEIPT_FAILED, COPY.PREPARATION_RECEIPT_FAILED));
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  if (!visible) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Person and shares</Text>
      <Text style={styles.text}>
        {member === 'new' ? 'New investor/member' : members.find((row) => row.member === member)?.name || member}
      </Text>
      <Action
        label="Use a new investor/member"
        disabled={busy || blocked || held || member === 'new'}
        onPress={() => setMember('new')}
      />
      {members
        .filter((row) => row.walletless && row.particularsRetained)
        .map((row) => (
          <Action
            key={row.member}
            label={`Use ${row.name || row.member}`}
            accessibilityLabel={`Use retained investor ${row.name || row.member} ${row.member}`}
            disabled={busy || blocked || held || member === row.member}
            onPress={() => setMember(row.member)}
          />
        ))}
      {(
        [
          ...(member === 'new' ? (['name', 'residentialAddress'] as const) : []),
          'shares',
          'consideration',
          'receivedAmount',
          'agreementReference',
          'agreementOn',
          'receivedOn',
          'terms',
          'approvingDirector',
          'authorityReference',
          'reason',
        ] as const
      ).map((key) => {
        const label = {
          name: 'Investor name',
          residentialAddress: 'Residential address',
          shares: COPY.SHARES,
          consideration: COPY.CONSIDERATION,
          receivedAmount: COPY.RECEIVED_AMOUNT,
          agreementReference: COPY.AGREEMENT_REFERENCE,
          agreementOn: COPY.AGREEMENT_ON,
          receivedOn: COPY.RECEIVED_ON,
          terms: COPY.TERMS,
          approvingDirector: COPY.DIRECTOR,
          authorityReference: COPY.AUTHORITY_REFERENCE,
          reason: COPY.REASON,
        }[key];
        return (
          <View key={key}>
            {key === 'receivedAmount' && <Text style={styles.heading}>Agreement and company receipt</Text>}
            {key === 'approvingDirector' && <Text style={styles.heading}>Company authority and review</Text>}
            <Field
              key={key}
              label={label}
              value={fields[key]}
              editable={!busy && !blocked && !held}
              keyboardType={
                key === 'shares'
                  ? 'number-pad'
                  : key === 'consideration' || key === 'receivedAmount'
                    ? 'decimal-pad'
                    : 'default'
              }
              maxLength={key === 'shares' ? 78 : ['terms', 'reason', 'residentialAddress'].includes(key) ? 1000 : 255}
              onChange={(value) => setFields((current) => ({ ...current, [key]: value }))}
            />
          </View>
        );
      })}
      {(['authority', 'agreement', 'receipt'] as const).map((kind) => (
        <EvidencePicker
          key={kind}
          title={COPY.DOCUMENTS[kind]}
          noun={kind === 'receipt' ? 'receipt evidence' : `${kind} document`}
          evidence={documents[kind]}
          disabled={busy || blocked || held}
          onPick={() => void pick(kind)}
        />
      ))}
      <Text style={styles.muted}>
        {COPY.RECEIPT_NOTE} The approving director must not be the recipient. Dates use YYYY-MM-DD.{' '}
        {COPY.EFFECTIVE_NOTE}
      </Text>
      {problem && <Text style={styles.muted}>{problem}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>
      <Action
        label={submitting ? 'Preparing allotment…' : COPY.SUBMIT}
        primary
        disabled={busy || blocked || (!held && !!problem)}
        onPress={() => void submit()}
      />
    </View>
  );
}

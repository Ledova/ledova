import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  REGISTER_AWARD_COPY as COPY,
  apiErrorSentence,
  appointmentForRegisterStep,
  createUserFriendlyError,
  failureStatus,
  getRegisterAward,
  getErrorMessage,
  isRecordedRegisterAward,
  recordRegisterAward,
  type OwnCompanyAppointment,
  type RegisterAwardPreparation,
  type RegisterTransferMember,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { EvidencePicker, Field, isoDay, utcToday } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { registerAppointmentsKey } from '../../hooks/useCompanyRegister';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';

export function AwardForm({
  company,
  token,
  epoch,
  members,
  appointment,
  guard,
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
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const agreement = useRegisterEvidence(company, 'supporting');
  const [newMemberId] = useState(() => Crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [shares, setShares] = useState('');
  const [termsOn, setTermsOn] = useState(utcToday);
  const [terms, setTerms] = useState('');
  const [schedule, setSchedule] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unavailable = useRef(blocked || !visible);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
  }, [blocked, visible]);
  const live = useRef(true);
  const pending = useRef(false);
  const operation = useRef<{ request: RegisterAwardPreparation; confirmed: boolean; uncertain: boolean } | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (unavailable.current)
      throw createUserFriendlyError('Refresh company access and the current records before continuing.');
    if (!live.current) throw createUserFriendlyError('This award form is closed. Reopen it before continuing.');
  };
  const date = termsOn.trim();
  const quantity = shares.trim();
  const problem =
    member === 'new' && (!name.trim() || !address.trim())
      ? 'Give the promised recipient’s name and residential address.'
      : !/^[1-9]\d*$/.test(quantity) || BigInt(quantity) >= 2n ** 256n
        ? 'Enter a positive whole number of promised shares.'
        : !isoDay(date) || date > utcToday()
          ? 'Enter an agreement date as YYYY-MM-DD, today (UTC) or earlier.'
          : !terms.trim() || !schedule.trim() || !agreement.name
            ? 'Give the agreement terms, recorded schedule and agreement document.'
            : null;
  const beforeWrite = () => {
    check();
    const appointments = client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [];
    if (appointmentForRegisterStep(appointments, company, 'prepare')?.uuid !== appointment.uuid)
      throw createUserFriendlyError('Refresh your current preparation appointment before a new request.');
  };
  const busy = submitting || agreement.busy;
  useEffect(() => {
    onHeldChange?.(busy || held);
  }, [busy, held, onHeldChange]);
  useEffect(() => () => onHeldChange?.(false), [onHeldChange]);
  const pick = async () => {
    try {
      check();
      await agreement.pick();
      check();
    } catch (cause) {
      try {
        check();
      } catch {
        return;
      }
      setError(getErrorMessage(cause, 'The agreement could not be selected. Try again.'));
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
        const retained = await agreement.upload(appointment.uuid, beforeWrite);
        const body = {
          appointment: appointment.uuid,
          tokenId: token,
          member: member === 'new' ? newMemberId : member,
          newMember: member === 'new',
          ...(member === 'new' ? { name: name.trim(), residentialAddress: address.trim() } : {}),
          shares: quantity,
          termsOn: date,
          terms: terms.trim(),
          schedule: schedule.trim(),
          agreementEvidence: retained.uuid,
        };
        command = { request: { operationId: Crypto.randomUUID(), ...body }, confirmed: false, uncertain: false };
        operation.current = command;
        setHeld(true);
        onHeldChange?.(true);
      }
      const lookup = async () => {
        try {
          check();
          const { data } = await getRegisterAward(apiClient, command!.request.operationId, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isRecordedRegisterAward(data, command!.request, company))
            throw createUserFriendlyError(COPY.RECORDING_FAILED);
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
          const { data } = await recordRegisterAward(apiClient, command.request, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: writeGuard,
          });
          check();
          if (!isRecordedRegisterAward(data, command.request, company))
            throw createUserFriendlyError(COPY.RECORDING_FAILED);
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
              'The original award was not recorded and the request was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
      }
      await onRecorded();
      operation.current = null;
      if (live.current) {
        setHeld(false);
        onHeldChange?.(false);
      }
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          if (live.current) {
            setHeld(false);
            onHeldChange?.(false);
          }
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, COPY.RECORDING_FAILED, COPY.RECORDING_FAILED));
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  if (!visible) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Person and award</Text>
      <Text style={styles.text}>
        {member === 'new' ? 'New recipient' : members.find((row) => row.member === member)?.name || member}
      </Text>
      <Action
        label="Use a new recipient"
        disabled={busy || blocked || held || member === 'new'}
        onPress={() => setMember('new')}
      />
      {members
        .filter((row) => row.walletless && row.particularsRetained)
        .map((row) => (
          <Action
            key={row.member}
            label={`Use ${row.name || row.member}`}
            accessibilityLabel={`Use retained recipient ${row.name || row.member} ${row.member}`}
            disabled={busy || blocked || held || member === row.member}
            onPress={() => setMember(row.member)}
          />
        ))}
      {member === 'new' && (
        <>
          <Field
            label="Recipient name"
            value={name}
            editable={!busy && !blocked && !held}
            maxLength={255}
            onChange={setName}
          />
          <Field
            label="Residential address"
            value={address}
            editable={!busy && !blocked && !held}
            multiline
            maxLength={1000}
            onChange={setAddress}
          />
        </>
      )}
      <Field
        label={COPY.SHARES}
        value={shares}
        editable={!busy && !blocked && !held}
        keyboardType="number-pad"
        maxLength={78}
        onChange={setShares}
      />
      <Text style={styles.heading}>Agreement and vesting schedule</Text>
      <Field
        label={`${COPY.TERMS_ON} (YYYY-MM-DD)`}
        accessibilityLabel={COPY.TERMS_ON}
        value={termsOn}
        editable={!busy && !blocked && !held}
        onChange={setTermsOn}
      />
      <Field
        label={COPY.TERMS}
        value={terms}
        editable={!busy && !blocked && !held}
        multiline
        maxLength={1000}
        onChange={setTerms}
      />
      <Field
        label={COPY.SCHEDULE}
        value={schedule}
        editable={!busy && !blocked && !held}
        multiline
        maxLength={1000}
        onChange={setSchedule}
      />
      <EvidencePicker
        title={COPY.AGREEMENT_DOCUMENT}
        noun="agreement document"
        evidence={agreement}
        disabled={busy || blocked || held}
        onPick={() => void pick()}
      />
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      {problem && <Text style={styles.muted}>{problem}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>
      <Action
        label={submitting ? 'Recording award…' : COPY.SUBMIT}
        primary
        disabled={busy || blocked || (!held && !!problem)}
        onPress={() => void submit()}
      />
    </View>
  );
}

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
  getRegisterAwardVesting,
  getErrorMessage,
  isRecordedRegisterAwardVesting,
  recordRegisterAwardVesting,
  type OwnCompanyAppointment,
  type RegisterAward,
  type RegisterAwardVestingPreparation,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { EvidencePicker, Field, isoDay, utcToday } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { registerAppointmentsKey } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

export function AwardVestingForm({
  award,
  epoch,
  appointment,
  guard,
  blocked,
  onRecorded,
  onHeldChange,
  visible = true,
}: {
  award: RegisterAward;
  epoch: number;
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const evidence = useRegisterEvidence(award.company, 'supporting');
  const [shares, setShares] = useState('');
  const [vestedOn, setVestedOn] = useState(utcToday);
  const [submitting, setSubmitting] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unavailable = useRef(blocked || !visible);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
  }, [blocked, visible]);
  const live = useRef(true);
  const pending = useRef(false);
  const operation = useRef<{ request: RegisterAwardVestingPreparation; confirmed: boolean; uncertain: boolean } | null>(
    null,
  );
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
    if (!live.current) throw createUserFriendlyError('This vesting form is closed. Reopen it before continuing.');
  };
  const quantity = shares.trim();
  const date = vestedOn.trim();
  const problem =
    !/^[1-9]\d*$/.test(quantity) || BigInt(quantity) > BigInt(award.shares) - BigInt(award.vestedShares)
      ? 'Enter a positive whole quantity within the award’s unvested shares.'
      : !isoDay(date) || date > utcToday()
        ? 'Enter a vesting date as YYYY-MM-DD, today (UTC) or earlier.'
        : !evidence.name
          ? 'Choose the company’s evidence for this vesting event.'
          : null;
  const beforeWrite = () => {
    check();
    const appointments = client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [];
    if (appointmentForRegisterStep(appointments, award.company, 'prepare')?.uuid !== appointment.uuid)
      throw createUserFriendlyError('Refresh your current preparation appointment before a new request.');
  };
  const busy = submitting || evidence.busy;
  useEffect(() => {
    onHeldChange?.(busy || held);
  }, [busy, held, onHeldChange]);
  useEffect(() => () => onHeldChange?.(false), [onHeldChange]);
  const pick = async () => {
    try {
      check();
      await evidence.pick();
      check();
    } catch (cause) {
      try {
        check();
      } catch {
        return;
      }
      setError(getErrorMessage(cause, 'The vesting evidence could not be selected. Try again.'));
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
        const retained = await evidence.upload(appointment.uuid, beforeWrite);
        const body = {
          appointment: appointment.uuid,
          award: award.uuid,
          shares: quantity,
          vestedOn: date,
          evidence: retained.uuid,
        };
        command = { request: { operationId: Crypto.randomUUID(), ...body }, confirmed: false, uncertain: false };
        operation.current = command;
        setHeld(true);
        onHeldChange?.(true);
      }
      const lookup = async () => {
        try {
          check();
          const { data } = await getRegisterAwardVesting(apiClient, command!.request.operationId, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isRecordedRegisterAwardVesting(data, command!.request, award.company))
            throw createUserFriendlyError(COPY.VESTING_FAILED);
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
          const { data } = await recordRegisterAwardVesting(apiClient, command.request, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: writeGuard,
          });
          check();
          if (!isRecordedRegisterAwardVesting(data, command.request, award.company))
            throw createUserFriendlyError(COPY.VESTING_FAILED);
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
              'The original vesting event was not recorded and the request was refused. Close this form and start again with current company authority.',
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
      setError(apiErrorSentence(cause, COPY.VESTING_FAILED, COPY.VESTING_FAILED));
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  if (!visible) return null;
  return (
    <View style={styles.group}>
      <Field
        label={COPY.VESTING_SHARES}
        value={shares}
        editable={!busy && !blocked && !held}
        keyboardType="number-pad"
        maxLength={78}
        onChange={setShares}
      />
      <Field
        label={`${COPY.VESTED_ON} (YYYY-MM-DD)`}
        accessibilityLabel={COPY.VESTED_ON}
        value={vestedOn}
        editable={!busy && !blocked && !held}
        onChange={setVestedOn}
      />
      <EvidencePicker
        title={COPY.VESTING_DOCUMENT}
        noun="vesting evidence"
        evidence={evidence}
        disabled={busy || blocked || held}
        onPick={() => void pick()}
      />
      <Text style={styles.muted}>{COPY.VESTING_NOTE}</Text>
      {problem && <Text style={styles.muted}>{problem}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>
      <Action
        label={submitting ? 'Recording vesting…' : 'Record vesting'}
        primary
        disabled={busy || blocked || (!held && !!problem)}
        onPress={() => void submit()}
      />
    </View>
  );
}

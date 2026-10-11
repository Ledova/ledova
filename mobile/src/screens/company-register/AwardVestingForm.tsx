import { useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  REGISTER_AWARD_COPY as COPY,
  apiErrorSentence,
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
import { useRegisterEvidence } from './useRegisterEvidence';

export function AwardVestingForm({
  award,
  epoch,
  appointment,
  guard,
  blocked,
  onRecorded,
  onHeldChange,
}: {
  award: RegisterAward;
  epoch: number;
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange?: (held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const evidence = useRegisterEvidence(award.company, 'supporting');
  const [shares, setShares] = useState('');
  const [vestedOn, setVestedOn] = useState(utcToday);
  const [submitting, setSubmitting] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const busy = submitting || evidence.busy;
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
        const retained = await evidence.upload(appointment.uuid, check);
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
      if (command.uncertain && !command.confirmed) {
        try {
          check();
          const { data } = await getRegisterAwardVesting(apiClient, command.request.operationId, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isRecordedRegisterAwardVesting(data, command.request, award.company))
            throw createUserFriendlyError(COPY.VESTING_FAILED);
          command.confirmed = true;
        } catch (cause) {
          check();
          if (failureStatus(cause) !== 404) throw cause;
        }
      }
      if (!command.confirmed) {
        check();
        const response = await recordRegisterAwardVesting(apiClient, command.request, {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: check,
        });
        check();
        if (!isRecordedRegisterAwardVesting(response.data, command.request, award.company))
          throw createUserFriendlyError(COPY.VESTING_FAILED);
        command.confirmed = true;
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
        label={submitting ? 'Recording vesting…' : COPY.VEST}
        primary
        disabled={busy || blocked || (!held && !!problem)}
        onPress={() => void submit()}
      />
    </View>
  );
}

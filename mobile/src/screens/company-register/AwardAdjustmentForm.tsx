import {
  REGISTER_AWARD_COPY as COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getRegisterAwardEnd,
  getRegisterAwardVestingReversal,
  isRecordedRegisterAwardEnd,
  isRecordedRegisterAwardVestingReversal,
  recordRegisterAwardEnd,
  recordRegisterAwardVestingReversal,
  type OwnCompanyAppointment,
  type RegisterAward,
  type RegisterAwardEndPreparation,
  type RegisterAwardVestingReversalPreparation,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Action } from '../../components/Ledger';
import { EvidencePicker, Field, isoDay, utcToday } from '../../components/register/RegisterFields';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type Command = (
  | { kind: 'end'; request: RegisterAwardEndPreparation }
  | { kind: 'reversal'; request: RegisterAwardVestingReversalPreparation }
) & { confirmed: boolean; uncertain: boolean; evidenceFingerprint: string };

export function AwardAdjustmentForm({
  award,
  epoch,
  appointment,
  vesting,
  vestingLabel,
  reversibleShares,
  guard,
  blocked,
  visible,
  canPrepare,
  onRecorded,
  onHeldChange,
}: {
  award: RegisterAward;
  epoch: number;
  appointment: OwnCompanyAppointment;
  vesting?: string;
  reversibleShares?: string;
  vestingLabel?: string;
  guard: () => void;
  blocked: boolean;
  visible: boolean;
  canPrepare: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const evidence = useRegisterEvidence(award.company, 'supporting');
  const [unvestedShares, setUnvestedShares] = useState('0');
  const [vestedShares, setVestedShares] = useState('0');
  const [reversedShares, setReversedShares] = useState('');
  const [companyEventOn, setCompanyEventOn] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setBusy] = useState(false);
  const busy = submitting || evidence.busy;
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const unavailable = useRef(blocked || !visible);
  const preparable = useRef(canPrepare);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
    preparable.current = canPrepare;
  }, [blocked, visible, canPrepare]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const pending = useRef(false);
  const operation = useRef<Command | null>(null);
  const check = () => {
    guard();
    if (!live.current || unavailable.current)
      throw createUserFriendlyError('Refresh company access and the current award records before continuing.');
  };
  const beforeWrite = () => {
    check();
    if (!preparable.current) throw createUserFriendlyError('Current preparation authority is required.');
  };
  const today = utcToday();
  const problem = vesting
    ? !/^[1-9]\d*$/.test(reversedShares) ||
      !reversibleShares ||
      BigInt(reversedShares) > BigInt(reversibleShares) ||
      BigInt(reversedShares) > BigInt(award.availableShares)
      ? 'Enter a positive whole quantity within this vesting’s unreversed shares and the available unissued rights.'
      : null
    : !/^\d+$/.test(unvestedShares) ||
        !/^\d+$/.test(vestedShares) ||
        BigInt(unvestedShares) > BigInt(award.unvestedRemainingShares) ||
        BigInt(vestedShares) > BigInt(award.availableShares) ||
        BigInt(unvestedShares) + BigInt(vestedShares) === 0n
      ? 'Choose unvested or vested unissued quantities within the remaining entitlement.'
      : null;
  const validation =
    problem ||
    (!isoDay(companyEventOn) || companyEventOn > today
      ? 'Enter a company event date no later than today (UTC).'
      : !reason.trim()
        ? 'Enter the company’s reason.'
        : !evidence.name
          ? 'Choose the company’s supporting evidence.'
          : null);
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && validation)) return;
    pending.current = true;
    setBusy(true);
    onHeldChange(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        beforeWrite();
        const captured = {
          unvestedShares,
          vestedShares,
          reversedShares,
          companyEventOn,
          reason: reason.trim(),
          vesting,
        };
        const retained = await evidence.upload(appointment.uuid, beforeWrite);
        beforeWrite();
        const common = {
          operationId: Crypto.randomUUID(),
          appointment: appointment.uuid,
          companyEventOn: captured.companyEventOn,
          reason: captured.reason,
          evidence: retained.uuid,
        };
        command = captured.vesting
          ? {
              kind: 'reversal',
              request: { ...common, vesting: captured.vesting, reversedShares: captured.reversedShares },
              confirmed: false,
              uncertain: false,
              evidenceFingerprint: retained.sha256,
            }
          : {
              kind: 'end',
              request: {
                ...common,
                award: award.uuid,
                unvestedShares: captured.unvestedShares,
                vestedShares: captured.vestedShares,
              },
              confirmed: false,
              uncertain: false,
              evidenceFingerprint: retained.sha256,
            };
        operation.current = command;
        setHeld(true);
      }
      const lookup = async () => {
        try {
          check();
          const valid =
            command.kind === 'end'
              ? isRecordedRegisterAwardEnd(
                  (
                    await getRegisterAwardEnd(apiClient, command.request.operationId, {
                      ledovaSessionEpoch: epoch,
                      ledovaSubmissionGuard: check,
                    })
                  ).data,
                  command.request,
                  award.company,
                  command.evidenceFingerprint,
                )
              : isRecordedRegisterAwardVestingReversal(
                  (
                    await getRegisterAwardVestingReversal(apiClient, command.request.operationId, {
                      ledovaSessionEpoch: epoch,
                      ledovaSubmissionGuard: check,
                    })
                  ).data,
                  command.request,
                  award.company,
                  award.uuid,
                  command.evidenceFingerprint,
                );
          check();
          if (!valid) throw createUserFriendlyError(COPY.ADJUSTMENT_FAILED);
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
          const valid =
            command.kind === 'end'
              ? isRecordedRegisterAwardEnd(
                  (
                    await recordRegisterAwardEnd(apiClient, command.request, {
                      ledovaSessionEpoch: epoch,
                      ledovaSubmissionGuard: writeGuard,
                    })
                  ).data,
                  command.request,
                  award.company,
                  command.evidenceFingerprint,
                )
              : isRecordedRegisterAwardVestingReversal(
                  (
                    await recordRegisterAwardVestingReversal(apiClient, command.request, {
                      ledovaSessionEpoch: epoch,
                      ledovaSubmissionGuard: writeGuard,
                    })
                  ).data,
                  command.request,
                  award.company,
                  award.uuid,
                  command.evidenceFingerprint,
                );
          check();
          if (!valid) throw createUserFriendlyError(COPY.ADJUSTMENT_FAILED);
          command.confirmed = true;
        } catch (cause) {
          const status = failureStatus(cause);
          if (!absent || !status || status < 400 || status >= 500) throw cause;
          command.confirmed = await lookup();
          if (!command.confirmed) {
            operation.current = null;
            setHeld(false);
            setError(
              'The original change was not recorded and was refused. Close this form and start again with current company authority.',
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
          if (live.current) setHeld(false);
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, COPY.ADJUSTMENT_FAILED, COPY.ADJUSTMENT_FAILED));
    } finally {
      pending.current = false;
      if (live.current) {
        setBusy(false);
        onHeldChange(!!operation.current);
      }
    }
  };
  useEffect(() => {
    onHeldChange(busy || held);
  }, [busy, held, onHeldChange]);
  useEffect(() => () => onHeldChange(false), [onHeldChange]);
  const pick = async () => {
    try {
      beforeWrite();
      await evidence.pick();
      beforeWrite();
    } catch (cause) {
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, COPY.ADJUSTMENT_FAILED, COPY.ADJUSTMENT_FAILED));
    }
  };
  if (!visible) return null;
  const editable = !busy && !blocked && !held && canPrepare;
  return (
    <View style={styles.group}>
      <Text style={styles.muted}>{vesting ? COPY.REVERSAL_NOTE : COPY.END_NOTE}</Text>
      {vesting && <Text style={styles.text}>Original vesting: {vestingLabel}</Text>}
      {vesting ? (
        <Field
          label={COPY.REVERSED_SHARES}
          value={reversedShares}
          editable={editable}
          keyboardType="number-pad"
          maxLength={78}
          onChange={setReversedShares}
        />
      ) : (
        <>
          <Field
            label={COPY.END_UNVESTED}
            value={unvestedShares}
            editable={editable}
            keyboardType="number-pad"
            maxLength={78}
            onChange={setUnvestedShares}
          />
          <Field
            label={COPY.END_VESTED}
            value={vestedShares}
            editable={editable}
            keyboardType="number-pad"
            maxLength={78}
            onChange={setVestedShares}
          />
        </>
      )}
      <Field
        label={`${COPY.COMPANY_EVENT_ON} (YYYY-MM-DD)`}
        accessibilityLabel={COPY.COMPANY_EVENT_ON}
        value={companyEventOn}
        editable={editable}
        onChange={setCompanyEventOn}
      />
      <Field label={COPY.REASON} value={reason} editable={editable} multiline maxLength={1000} onChange={setReason} />
      <EvidencePicker
        title={COPY.ADJUSTMENT_DOCUMENT}
        noun="supporting evidence"
        evidence={evidence}
        disabled={!editable}
        onPick={() => void pick()}
      />
      {validation && <Text style={styles.muted}>{validation}</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {held && <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>}
      <Action
        label={busy ? 'Recording change…' : vesting ? COPY.REVERSE : COPY.END}
        primary
        disabled={busy || blocked || (!held && (!canPrepare || !!validation))}
        onPress={() => void submit()}
      />
    </View>
  );
}

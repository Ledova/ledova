import {
  downloadRegisterPauseChangeFile,
  failureStatus,
  isRegisterEvidenceReceipt,
  uploadRegisterEvidence,
  useCompanyPauseChanges,
  type RegisterEvidence,
  type RegisterPauseChange,
  failureSentence,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import { useEffect, useRef, useState } from 'react';

export type Commands = ReturnType<typeof useCompanyPauseChanges>;
export function usePauseRecord({ record, commands }: { record: RegisterPauseChange; commands: Commands }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterPauseChangeFile(apiClient, record.uuid, commands.config(commands.guard));
      commands.guard();
      saveFile(response.data, `pause-authority-${record.uuid}`);
    } catch (failure) {
      setError(failureSentence(failure, 'The retained authority copy could not be downloaded.'));
    } finally {
      setBusy(false);
    }
  };
  const execution = record.execution;
  return { error, busy, download, execution };
}
export function usePausePreparation({ commands }: { commands: Commands }) {
  const [captured, setCaptured] = useState(() => (commands.source ? { ...commands.source } : undefined));
  const [paused, setPaused] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const uploadRef = useRef<{ file: File; appointment: string; key: string; receipt: RegisterEvidence | null } | null>(
    null,
  );
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const termsValid =
    paused !== null &&
    !!reason.trim() &&
    reason.trim().length <= 1000 &&
    !!reference.trim() &&
    reference.trim().length <= 255;
  const waiting = busy || commands.busy;
  const check = () => {
    if (!mounted.current) throw new Error('This pause form is closed.');
    commands.guardPause('prepare', {
      token: captured,
      paused: paused!,
      reason: reason.trim(),
      authorityReference: reference.trim(),
    });
  };
  const submit = async () => {
    if (waiting || !commands.canPrepare || commands.recovery || !termsValid || !file) return;
    setBusy(true);
    setError('');
    try {
      check();
      const appointment = commands.steps.prepare!.uuid;
      const prior = uploadRef.current;
      const same = prior?.file === file && prior.appointment === appointment;
      const key = same ? prior.key : crypto.randomUUID();
      let receipt = same ? prior.receipt : null;
      if (!receipt) {
        uploadRef.current = { file, appointment, key, receipt: null };
        const body = { companyId: commands.company, appointment, kind: 'authority' as const, idempotencyKey: key };
        const response = await uploadRegisterEvidence(apiClient, { ...body, file }, commands.config(check));
        check();
        if (!isRegisterEvidenceReceipt(response.data, body, file.size))
          throw new Error('The exact company authority receipt could not be confirmed.');
        receipt = response.data;
        uploadRef.current = { file, appointment, key, receipt };
      }
      check();
      await commands.prepare(
        {
          paused: paused!,
          reason: reason.trim(),
          authorityReference: reference.trim(),
          authorityEvidence: receipt.uuid,
        },
        captured,
      );
    } catch (failure) {
      if (failureStatus(failure) === 409) uploadRef.current = null;
      try {
        commands.guard();
        if (mounted.current) setError(failureSentence(failure, 'The pause change could not be prepared.'));
      } catch {
        return;
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return {
    setCaptured,
    paused,
    setPaused,
    reason,
    setReason,
    reference,
    setReference,
    file,
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    termsValid,
    waiting,
    check,
    submit,
  };
}

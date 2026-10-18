import {
  downloadRegisterPaidIssueFile,
  failureStatus,
  getErrorMessage,
  isRegisterEvidenceReceipt,
  uploadRegisterEvidence,
  useCompanyPaidIssues,
  type RegisterEvidence,
  type RegisterPaidIssue,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import { useEffect, useRef, useState } from 'react';
export type Commands = ReturnType<typeof useCompanyPaidIssues>;
export function usePaidIssueRecord({ record, commands }: { record: RegisterPaidIssue; commands: Commands }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterPaidIssueFile(apiClient, record.uuid, commands.config(commands.guard));
      commands.guard();
      saveFile(response.data, `paid-issue-authority-${record.uuid}`);
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The retained authority copy could not be downloaded.') ??
          'The request could not be confirmed.',
      );
    } finally {
      setBusy(false);
    }
  };
  const execution = record.execution;
  return { error, busy, download, execution };
}
export function usePaidIssuePreparation({ commands }: { commands: Commands }) {
  const [captured, setCaptured] = useState<Parameters<Commands['prepare']>[1] | null>(null);
  const [director, setDirector] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
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
    !!captured &&
    !!director.trim() &&
    director.trim().length <= 255 &&
    !!reference.trim() &&
    reference.trim().length <= 255 &&
    !!reason.trim() &&
    reason.trim().length <= 1000;
  const waiting = busy || commands.busy;
  const check = () => {
    if (!mounted.current || !captured) throw new Error('Choose an exact recorded paid subscription.');
    commands.guardPaidIssue('prepare', captured);
  };
  const select = (subscription: string) => {
    try {
      const source = commands.availableSubscriptions.data?.find((row) => row.subscription === subscription);
      if (!source) throw new Error('Choose an available recorded paid subscription.');
      const next = { source: { ...source }, token: commands.source ? { ...commands.source } : undefined };
      commands.guardPaidIssue('prepare', next);
      setCaptured(next);
      uploadRef.current = null;
      setFile(null);
      setError('');
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The paid source could not be selected.') ?? 'The source could not be confirmed.',
      );
    }
  };
  const submit = async () => {
    if (waiting || !commands.canPrepare || commands.recovery || !termsValid || !file || !captured) return;
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
          subscription: captured.source.subscription,
          approvingDirector: director.trim(),
          authorityReference: reference.trim(),
          reason: reason.trim(),
          authorityEvidence: receipt.uuid,
        },
        captured,
      );
    } catch (failure) {
      if (failureStatus(failure) === 409) uploadRef.current = null;
      try {
        commands.guard();
        if (mounted.current)
          setError(
            getErrorMessage(failure, 'The paid issue could not be prepared.') ?? 'The request could not be confirmed.',
          );
      } catch {
        return;
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const candidates = commands.availableSubscriptions.data ?? [];
  return {
    captured,
    director,
    setDirector,
    reference,
    setReference,
    reason,
    setReason,
    file,
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    termsValid,
    waiting,
    check,
    select,
    submit,
    candidates,
  };
}

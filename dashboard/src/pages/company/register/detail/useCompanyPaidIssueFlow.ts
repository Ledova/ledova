import {
  downloadRegisterPaidIssueFile,
  failureStatus,
  isRegisterEvidenceReceipt,
  uploadRegisterEvidence,
  useCompanyPaidIssues,
  type RegisterEvidence,
  type RegisterPaidIssue,
  failureSentence,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import type { Problems } from '@hooks/useErrorSummary';
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
      setError(failureSentence(failure, 'The retained authority copy could not be downloaded.'));
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
  const problems: Problems<'source' | 'director' | 'reference' | 'reason' | 'file'> = {
    source: !captured && 'Choose a recorded paid subscription.',
    director: !director.trim() && 'Name the approving director.',
    reference: !reference.trim() && 'Give the authority reference.',
    reason: !reason.trim() && 'Give the paid issue reason.',
    file: !file && 'Choose the paid issue authority document.',
  };
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
      setError(failureSentence(failure, 'The paid source could not be selected.'));
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
        if (mounted.current) setError(failureSentence(failure, 'The paid issue could not be prepared.'));
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
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    termsValid,
    problems,
    waiting,
    check,
    select,
    submit,
    candidates,
  };
}

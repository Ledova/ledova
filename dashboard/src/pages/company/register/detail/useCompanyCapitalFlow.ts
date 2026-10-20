import {
  downloadRegisterCapitalIncreaseFile,
  failureStatus,
  isRegisterEvidenceReceipt,
  raisedSupply,
  requestShares,
  uploadRegisterEvidence,
  useCompanyCapitalIncreases,
  type RegisterCapitalIncrease,
  type RegisterEvidence,
  failureSentence,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import { useEffect, useRef, useState } from 'react';

export type Commands = ReturnType<typeof useCompanyCapitalIncreases>;
export function useCapitalRecord({ record, commands }: { record: RegisterCapitalIncrease; commands: Commands }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterCapitalIncreaseFile(
        apiClient,
        record.uuid,
        commands.config(commands.guard),
      );
      commands.guard();
      saveFile(response.data, `capital-authority-${record.uuid}`);
    } catch (failure) {
      setError(failureSentence(failure, 'The retained authority copy could not be downloaded.'));
    } finally {
      setBusy(false);
    }
  };
  const execution = record.execution;
  return { error, busy, download, execution };
}
export function useCapitalPreparation({ commands }: { commands: Commands }) {
  const [before, setBefore] = useState(() => commands.source?.totalSupply ?? '');
  const [additional, setAdditional] = useState('');
  const [purpose, setPurpose] = useState('');
  const [board, setBoard] = useState('');
  const [shareholder, setShareholder] = useState('');
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
  const additionalShares = requestShares(additional);
  const total = raisedSupply(before, additional);
  const newAuthorizedTotal = total === null ? null : requestShares(total);
  const valid =
    additionalShares !== null &&
    newAuthorizedTotal !== null &&
    !!purpose.trim() &&
    !!board.trim() &&
    board.trim().length <= 255 &&
    shareholder.trim().length <= 255 &&
    !!file;
  const waiting = busy || commands.busy;
  const submit = async () => {
    if (waiting || !commands.canPrepare || commands.recovery || !valid) return;
    setBusy(true);
    setError('');
    const check = () => {
      if (!mounted.current) throw new Error('This capital form is closed.');
      commands.guardCapital('prepare', {
        priorAuthorizedTotal: before,
        additionalShares: additionalShares!,
        newAuthorizedTotal: newAuthorizedTotal!,
      });
    };
    try {
      check();
      const appointment = commands.steps.prepare!.uuid;
      const prior = uploadRef.current;
      const same = prior?.file === file && prior.appointment === appointment;
      const key = same ? prior.key : crypto.randomUUID();
      let receipt = same ? prior.receipt : null;
      if (!receipt) {
        uploadRef.current = { file: file!, appointment, key, receipt: null };
        const body = { companyId: commands.company, appointment, kind: 'authority' as const, idempotencyKey: key };
        const response = await uploadRegisterEvidence(apiClient, { ...body, file: file! }, commands.config(check));
        check();
        if (!isRegisterEvidenceReceipt(response.data, body, file!.size))
          throw new Error('The exact company authority receipt could not be confirmed.');
        receipt = response.data;
        uploadRef.current = { file: file!, appointment, key, receipt };
      }
      check();
      await commands.prepare(
        {
          additionalShares: additionalShares!,
          newAuthorizedTotal: newAuthorizedTotal!,
          purpose: purpose.trim(),
          boardResolutionReference: board.trim(),
          shareholderApprovalReference: shareholder.trim(),
          authorityEvidence: receipt.uuid,
        },
        before,
      );
    } catch (failure) {
      if (failureStatus(failure) === 409) uploadRef.current = null;
      try {
        commands.guard();
        if (mounted.current) setError(failureSentence(failure, 'The capital increase could not be prepared.'));
      } catch {
        return;
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return {
    before,
    setBefore,
    additional,
    setAdditional,
    purpose,
    setPurpose,
    board,
    setBoard,
    shareholder,
    setShareholder,
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    additionalShares,
    total,
    newAuthorizedTotal,
    valid,
    waiting,
    submit,
  };
}

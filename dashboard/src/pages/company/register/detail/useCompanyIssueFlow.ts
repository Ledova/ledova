import {
  downloadRegisterIssueFile,
  downloadRegisterLinkFile,
  failureStatus,
  getErrorMessage,
  isRegisterEvidenceReceipt,
  requestShares,
  uploadRegisterEvidence,
  useCompanyIssueInstructions,
  type RegisterEvidence,
  type RegisterIssue,
  type RegisterLink,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import { useEffect, useRef, useState } from 'react';
export type Commands = ReturnType<typeof useCompanyIssueInstructions>;
export type EvidenceKind = 'authority' | 'terms' | 'acceptance';
export function useIssueRecord({ record, commands }: { record: RegisterIssue; commands: Commands }) {
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<EvidenceKind | null>(null);
  const download = async (kind: EvidenceKind) => {
    if (downloading) return;
    setDownloading(kind);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterIssueFile(apiClient, record.uuid, kind, commands.config(commands.guard));
      commands.guard();
      saveFile(response.data, `${kind}-${record.uuid}`);
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The retained copy could not be downloaded.') ?? 'The request could not be confirmed.',
      );
    } finally {
      setDownloading(null);
    }
  };
  return { error, downloading, download };
}
export function useIssueLinkRecord({ record, commands }: { record: RegisterLink; commands: Commands }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterLinkFile(apiClient, record.uuid, commands.config(commands.guard));
      commands.guard();
      saveFile(response.data, `authority-${record.uuid}`);
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The retained authority copy could not be downloaded.') ??
          'The request could not be confirmed.',
      );
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, download };
}
export function useIssuePreparation({ commands }: { commands: Commands }) {
  const [nomination, setNomination] = useState('');
  const [member, setMember] = useState('new');
  const [newMember] = useState(() => crypto.randomUUID());
  const [approval, setApproval] = useState('');
  const [director, setDirector] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [shares, setShares] = useState('');
  const [termsOn, setTermsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState('');
  const [acceptanceRequired, setAcceptanceRequired] = useState(false);
  const [files, setFiles] = useState<Partial<Record<EvidenceKind, File>>>({});
  const uploads = useRef<
    Partial<Record<EvidenceKind, { file: File; appointment: string; key: string; receipt: RegisterEvidence | null }>>
  >({});
  const [busy, setBusy] = useState<'link' | 'issue' | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const chosen = commands.nominations.data?.find((row) => row.uuid === nomination);
  const selectedMember = member === 'new' ? newMember : member;
  const approvals = (commands.walletApprovals.data ?? []).filter(
    (row) =>
      row.action === 'add' &&
      row.nomination === nomination &&
      row.changeId &&
      ['confirmed', 'unchanged'].includes(row.execution?.status ?? ''),
  );
  const appliedNewLink =
    chosen &&
    commands.linksRecords.some(
      (link) =>
        link.status === 'applied' &&
        link.mapping.some(
          (row) => row.member === newMember && row.address.toLowerCase() === chosen.address.toLowerCase(),
        ),
    );
  const displayedMember = member === 'new' && appliedNewLink ? newMember : member;
  const waiting = !!busy || commands.busy;
  const commonProblem = !chosen || !director.trim() || !reference.trim() || !reason.trim() || !files.authority;
  const issueProblem =
    commonProblem ||
    displayedMember === 'new' ||
    !approval ||
    requestShares(shares) === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(termsOn) ||
    termsOn > new Date().toISOString().slice(0, 10) ||
    !terms.trim() ||
    !files.terms ||
    (acceptanceRequired && !files.acceptance);
  const submit = async (kind: 'link' | 'issue') => {
    if (waiting || !commands.canPrepare || commands.recovery || (kind === 'link' ? commonProblem : issueProblem))
      return;
    setBusy(kind);
    setError('');
    const mapping = [{ address: chosen!.address, member: selectedMember }];
    const check = () => {
      if (!mounted.current) throw new Error('This grant form is closed.');
      if (kind === 'link') commands.guardLink('prepare', { mapping, nomination });
      else commands.guardIssue('prepare', { member: selectedMember, nomination, walletApproval: approval });
    };
    const upload = async (slot: EvidenceKind) => {
      check();
      const file = files[slot]!;
      const appointment = commands.steps.prepare!.uuid;
      const prior = uploads.current[slot];
      const same = prior?.file === file && prior.appointment === appointment;
      if (same && prior.receipt) return prior.receipt;
      const key = same ? prior.key : crypto.randomUUID();
      uploads.current[slot] = { file, appointment, key, receipt: null };
      const request = {
        companyId: commands.company,
        appointment,
        kind: slot === 'authority' ? ('authority' as const) : ('supporting' as const),
        idempotencyKey: key,
      };
      const response = await uploadRegisterEvidence(apiClient, { ...request, file }, commands.config(check));
      check();
      if (!isRegisterEvidenceReceipt(response.data, request, file.size))
        throw new Error('The exact evidence receipt could not be confirmed.');
      uploads.current[slot] = { file, appointment, key, receipt: response.data };
      return response.data;
    };
    try {
      const authority = await upload('authority');
      if (kind === 'link')
        await commands.sendLink(
          {
            authorityEvidence: authority.uuid,
            mapping,
            authority: 'director_resolution',
            approvingDirector: director.trim(),
            authorityReference: reference.trim(),
            reason: reason.trim(),
          },
          nomination,
        );
      else {
        const retainedTerms = await upload('terms');
        const acceptance = acceptanceRequired ? await upload('acceptance') : null;
        await commands.sendIssue({
          member: selectedMember,
          nomination,
          walletApproval: approval,
          shares,
          termsOn,
          terms: terms.trim(),
          approvingDirector: director.trim(),
          authorityReference: reference.trim(),
          reason: reason.trim(),
          authorityEvidence: authority.uuid,
          termsEvidence: retainedTerms.uuid,
          acceptanceRequired,
          acceptanceEvidence: acceptance?.uuid ?? null,
        });
      }
    } catch (failure) {
      if (failureStatus(failure) === 409) uploads.current = {};
      if (mounted.current)
        setError(getErrorMessage(failure, 'The grant could not be prepared.') ?? 'The request could not be confirmed.');
    } finally {
      if (mounted.current) setBusy(null);
    }
  };
  return {
    nomination,
    setNomination,
    member,
    setMember,
    newMember,
    approval,
    setApproval,
    director,
    setDirector,
    reference,
    setReference,
    reason,
    setReason,
    shares,
    setShares,
    termsOn,
    setTermsOn,
    terms,
    setTerms,
    acceptanceRequired,
    setAcceptanceRequired,
    files,
    setFiles,
    error,
    chosen,
    approvals,
    displayedMember,
    waiting,
    preparing: busy,
    commonProblem,
    issueProblem,
    submit,
  };
}

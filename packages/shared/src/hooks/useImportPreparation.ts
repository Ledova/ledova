import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { REGISTER_IMPORT_COPY, REGISTER_IMPORT_UNMET_COPY } from '../constants/business/register-imports';
import { uploadRegisterEvidence } from '../services/register-commands';
import { prepareRegisterImport } from '../services/register-imports';
import type {
  OwnCompanyAppointment,
  RegisterDocumentFile,
  RegisterEvidence,
  RegisterEvidenceKind,
  RegisterImport,
  RegisterImportPreparation,
  RegisterTransferMember,
  TokenHoldersResponse,
} from '../types';
import { utcToday } from '../utils/date';
import { apiErrorSentence, createUserFriendlyError, failureStatus, refusalSentence } from '../utils/errors';
import { isRegisterEvidenceReceipt, type RegisterSteps } from '../utils/register-commands';
import {
  figuresDiffer,
  formerRows,
  initialMembers,
  memberIdentityProblems,
  memberRows,
  preparationProblems,
  statedFigures,
  type MemberDraft,
  type PreparationDraft,
} from '../utils/register-import-drafts';
import { isPreparedRegisterImport } from '../utils/register-imports';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import { REGISTER_IMPORT_DECISIONS, useRegisterDecision } from './useRegisterDecision';
import { importsKey } from './useRegisterImports';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

const CLOSED = 'This setup is closed. Reopen it before continuing.';

type Upload = { file: RegisterDocumentFile; appointment: string; key: string; receipt: RegisterEvidence | null };

export type ImportPreparationOptions = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  newEffectGuard?: () => void;
  company: string;
  register?: TokenHoldersResponse;
  appointment?: OwnCompanyAppointment;
  steps: RegisterSteps;
  blocked: boolean;
  onConflict: () => void;
  correction?: RegisterImport;
  saved?: RegisterImport;
  classProblems?: string[];
  resolveRegister?: () => Promise<{
    register: TokenHoldersResponse;
    members: RegisterTransferMember[];
    emptyOpeningAllowed: boolean;
  }>;
  companyMembers: RegisterTransferMember[];
  emptyOpeningAllowed?: boolean;
  visible?: boolean;
  onHeldChange?: (held: boolean) => void;
  onPrepared: (token: string, uuid: string) => void;
  onFinished: () => void;
  newKey: () => string;
  session?: OrderSubmissionSession;
};

export function useImportPreparation({
  owner,
  guard,
  newEffectGuard = guard,
  company,
  register,
  appointment,
  steps,
  blocked,
  onConflict,
  correction,
  saved,
  classProblems = [],
  resolveRegister,
  companyMembers,
  emptyOpeningAllowed = false,
  visible = true,
  onHeldChange,
  onPrepared,
  onFinished,
  newKey,
  session,
}: ImportPreparationOptions) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const today = utcToday();
  const [resolvedMembers, setResolvedMembers] = useState<{
    source: RegisterTransferMember[];
    members: RegisterTransferMember[];
  } | null>(null);
  const resolvedCurrent = resolvedMembers?.source === companyMembers;
  const knownMembers = resolvedCurrent ? resolvedMembers.members : companyMembers;
  const preserveParticulars = !correction && !register?.initialized;
  const reuseSavedCopies = !!saved?.preparingAppointment && saved.preparingAppointment === appointment?.uuid;
  const [draft, setDraft] = useState<PreparationDraft>(() => ({
    registerFile: null,
    asicFile: null,
    registerEvidence: reuseSavedCopies ? (saved?.registerEvidence ?? undefined) : undefined,
    asicEvidence: reuseSavedCopies ? (saved?.asicEvidence ?? undefined) : undefined,
    earlierCopiesNotReused: !reuseSavedCopies && !!(saved?.registerEvidence || saved?.asicEvidence),
    asAt: saved?.asAt ?? correction?.asAt ?? today,
    reference: saved?.sourceReference?.trim()
      ? saved.sourceReference
      : correction?.sourceReference?.trim()
        ? correction.sourceReference
        : 'Company-provided share records',
    reason: saved?.reason ?? (correction ? '' : 'Mirror the company’s existing share records.'),
    members: register
      ? emptyOpeningAllowed && !saved && !correction
        ? []
        : initialMembers(register, saved ?? correction, newKey)
      : [],
    former: (saved ?? correction)?.formerMembers.map((row) => ({ ...row, id: newKey() })) ?? [],
    statedTotal: saved?.asicIssuedTotal ?? '',
    statedCount: saved?.asicMemberCount?.toString() ?? '',
  }));
  const [proposal, setProposal] = useState<RegisterImport | undefined>(
    saved?.status === 'rejected' ? undefined : saved,
  );
  const [phase, setPhase] = useState<'details' | 'shareholders' | 'review'>(
    saved && saved.status !== 'rejected' ? 'review' : 'details',
  );
  const [holderEditor, setHolderEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [autoApply, setAutoApply] = useState(false);
  const [autoPreviewFinished, setAutoPreviewFinished] = useState(false);
  const [editing, setEditing] = useState(false);
  const applyOpened = useRef(false);
  const previewAttempt = useRef('');
  const preparation = useRef<RegisterImportPreparation | null>(null);
  const activeRegister = useRef(register);
  const uploads = useRef<Record<string, Upload>>({});
  const pending = useRef(false);
  const mounted = useRef(true);
  const currentSteps = useRef(steps);
  const currentPreparation = useRef(appointment);
  const currentContext = useRef({
    newEffectGuard,
    blocked,
    visible,
    companyMembers,
    emptyOpeningAllowed,
  });
  const currentMembers = useRef(knownMembers);
  useLayoutEffect(() => {
    currentSteps.current = steps;
    currentPreparation.current = appointment;
    currentContext.current = { newEffectGuard, blocked, visible, companyMembers, emptyOpeningAllowed };
    currentMembers.current = knownMembers;
  }, [steps, appointment, newEffectGuard, blocked, visible, knownMembers, companyMembers, emptyOpeningAllowed]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw createUserFriendlyError(CLOSED);
  };
  const config = (submissionGuard: () => void) => ({
    ...session?.requestConfig(),
    ledovaSubmissionGuard: submissionGuard,
  });
  const checkNew = () => {
    check();
    const context = currentContext.current;
    context.newEffectGuard();
    if (context.blocked || !context.visible)
      throw createUserFriendlyError('Refresh current company authority and records before continuing.');
  };
  const canPrepare = !!appointment && steps.prepare?.uuid === appointment.uuid;
  const checkPreparation = () => {
    checkNew();
    if (
      !appointment ||
      currentPreparation.current?.uuid !== appointment.uuid ||
      currentSteps.current.prepare?.uuid !== appointment.uuid
    )
      throw createUserFriendlyError('Current preparation access is required to change these records.');
    return appointment;
  };
  const checkDecision = (kind: 'approve' | 'apply' | 'reject') => {
    checkNew();
    if (!steps[kind] || currentSteps.current[kind]?.uuid !== steps[kind]?.uuid)
      throw createUserFriendlyError('Your appointment for this decision changed. Refresh before continuing.');
    if (kind === 'reject') checkPreparation();
  };
  const finish = async () => {
    check();
    await client.invalidateQueries({ queryKey: registerKey(owner) });
    check();
    onFinished();
  };
  const approve = useRegisterDecision(REGISTER_IMPORT_DECISIONS, proposal, {
    appointment: steps.approve?.uuid,
    newKey,
    guard: check,
    newEffectGuard: () => checkDecision('approve'),
    requestConfig: () => config(check),
    onDecided: (receipt) => {
      setProposal(receipt);
      applyOpened.current = false;
      setAutoPreviewFinished(false);
      setAutoApply(true);
    },
    onRefused: onConflict,
  });
  const apply = useRegisterDecision(REGISTER_IMPORT_DECISIONS, proposal, {
    appointment: steps.apply?.uuid,
    newKey,
    guard: check,
    newEffectGuard: () => checkDecision('apply'),
    requestConfig: () => config(check),
    onDecided: finish,
    onRefused: onConflict,
  });
  const reject = useRegisterDecision(REGISTER_IMPORT_DECISIONS, proposal, {
    appointment: steps.reject?.uuid,
    newKey,
    guard: check,
    newEffectGuard: () => checkDecision('reject'),
    requestConfig: () => config(check),
    onDecided: async () => {
      setProposal(undefined);
      preparation.current = null;
      setAutoApply(false);
      setEditing(false);
      setPhase('details');
      await client.invalidateQueries({ queryKey: importsKey(owner, activeRegister.current!.token.uuid) });
    },
    onRefused: onConflict,
  });
  useEffect(() => {
    if (!editing || reject.busy) return;
    if (!reject.target) {
      if (reject.error) void Promise.resolve().then(() => setEditing(false));
      return;
    }
    if (reject.target.preview.canDecide) void reject.confirm().finally(() => setEditing(false));
    else void Promise.resolve().then(() => setEditing(false));
  }, [editing, reject]);
  useEffect(() => {
    if (!autoApply || approve.busy || apply.busy || applyOpened.current || proposal?.stage !== 'approved') return;
    if (!steps.apply) {
      void Promise.resolve().then(() => setAutoApply(false));
      return;
    }
    applyOpened.current = true;
    previewAttempt.current = JSON.stringify([proposal.uuid, proposal.stage, steps.apply.uuid]);
    void apply.open('apply').finally(() => setAutoPreviewFinished(true));
  }, [autoApply, approve.busy, apply.busy, apply, proposal?.stage, steps.apply]);
  useEffect(() => {
    if (!autoApply || !autoPreviewFinished || apply.busy) return;
    if (apply.target?.preview.canDecide) void apply.confirm().finally(() => setAutoApply(false));
    else void Promise.resolve().then(() => setAutoApply(false));
  }, [autoApply, autoPreviewFinished, apply]);
  const deciding = approve.busy || apply.busy || reject.busy;
  const recovery = approve.recovery ? approve : apply.recovery ? apply : reject.recovery ? reject : null;
  const mutable = phase === 'details' || phase === 'shareholders';
  const held = busy || uncertain || deciding || !!recovery || !mutable;
  useEffect(() => {
    onHeldChange?.(held);
    return () => onHeldChange?.(false);
  }, [held, onHeldChange]);
  const update = (change: (current: PreparationDraft) => PreparationDraft) => {
    if (held || pending.current || !canPrepare) return;
    setError('');
    setDraft(change);
  };
  const setMember = (index: number, patch: Partial<MemberDraft>) =>
    update((current) => ({
      ...current,
      members: current.members.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    }));
  const differs = figuresDiffer(draft);
  const problems = [
    ...classProblems,
    ...preparationProblems(draft, today, !correction && emptyOpeningAllowed),
    ...memberIdentityProblems(draft.members, knownMembers, preserveParticulars),
    ...(differs
      ? [
          'The earlier ASIC comparison differs from the shareholder records. Check the source or leave out the comparison.',
        ]
      : []),
  ];
  const detailProblems = problems.filter(
    (problem) =>
      !problem.startsWith('Shareholder') &&
      !problem.startsWith('Add at least') &&
      !problem.startsWith('Each company') &&
      !problem.startsWith('Attach the optional') &&
      !problem.startsWith('Complete any former') &&
      !problem.startsWith('The earlier ASIC comparison') &&
      !problem.startsWith('Enter valid whole-number'),
  );
  const holderProblems = (index: number) =>
    problems.filter(
      (problem) =>
        problem.startsWith(`Shareholder ${index + 1}:`) ||
        problem.startsWith(`Shareholder ${index + 1},`) ||
        problem.startsWith('Each company'),
    );
  const upload = async (kind: RegisterEvidenceKind, file: RegisterDocumentFile, cacheKey = kind as string) => {
    const preparingAppointment = checkPreparation();
    const previous = uploads.current[cacheKey];
    const same = previous?.file === file && previous.appointment === preparingAppointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : newKey();
    uploads.current[cacheKey] = { file, appointment: preparingAppointment.uuid, key, receipt: null };
    const request = { companyId: company, appointment: preparingAppointment.uuid, kind, idempotencyKey: key };
    const { data } = await uploadRegisterEvidence(apiClient, { ...request, file }, config(checkPreparation));
    checkPreparation();
    if (!isRegisterEvidenceReceipt(data, request, file.size))
      throw createUserFriendlyError(REGISTER_IMPORT_COPY.UPLOAD_RECEIPT_FAILED);
    uploads.current[cacheKey] = { file, appointment: preparingAppointment.uuid, key, receipt: data };
    return data;
  };
  const prepare = async (recovering = false) => {
    if (pending.current || busy || deciding || (!recovering && holderEditor)) return;
    setAttempted(true);
    if (!recovering && (!canPrepare || blocked || problems.length)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (recovering) check();
      else checkPreparation();
      if (!preparation.current) {
        const preparingAppointment = checkPreparation();
        const resolved = !activeRegister.current ? await resolveRegister?.() : undefined;
        const current = activeRegister.current ?? resolved?.register;
        checkPreparation();
        if (!current) throw createUserFriendlyError('Choose the share class before continuing.');
        if (
          draft.members.length === 0 &&
          (correction ||
            draft.former.length > 0 ||
            !(resolved?.emptyOpeningAllowed ?? currentContext.current.emptyOpeningAllowed))
        )
          throw createUserFriendlyError('An empty opening requires an unopened share class with no chain activity.');
        const known = resolved?.members ?? currentMembers.current;
        const sourceAtResolution = currentContext.current.companyMembers;
        if (resolved) setResolvedMembers({ source: sourceAtResolution, members: known });
        const identityProblems = memberIdentityProblems(draft.members, known, preserveParticulars);
        if (identityProblems.length) {
          setUncertain(false);
          setError(identityProblems.join(' '));
          if (resolved) onConflict();
          return;
        }
        const registerEvidence = draft.registerFile ? await upload('share_register', draft.registerFile) : null;
        const asicEvidence = draft.asicFile ? await upload('asic_extract', draft.asicFile) : null;
        const preparedMembers: MemberDraft[] = [];
        for (const member of draft.members) {
          const documents: MemberDraft['documents'] = [];
          for (const document of member.documents) {
            const receipt = document.file
              ? await upload('supporting', document.file, `${member.member}/${document.id}`)
              : null;
            if (receipt || document.evidence)
              documents.push({ ...document, evidence: receipt?.uuid ?? document.evidence });
          }
          preparedMembers.push({ ...member, documents });
        }
        checkPreparation();
        if (draft.members.length === 0 && !currentContext.current.emptyOpeningAllowed)
          throw createUserFriendlyError('An empty opening requires an unopened share class with no chain activity.');
        const resolvedStillCurrent = resolved && currentContext.current.companyMembers === sourceAtResolution;
        const changedIdentity = memberIdentityProblems(
          draft.members,
          resolvedStillCurrent ? known : currentMembers.current,
          preserveParticulars,
        );
        if (changedIdentity.length) {
          setUncertain(false);
          setError(changedIdentity.join(' '));
          if (resolved) onConflict();
          return;
        }
        activeRegister.current = current;
        const stated = statedFigures(draft);
        preparation.current = {
          operationId: newKey(),
          appointment: preparingAppointment.uuid,
          tokenId: current.token.uuid,
          registerEvidence: registerEvidence?.uuid ?? draft.registerEvidence,
          asicEvidence: asicEvidence?.uuid ?? draft.asicEvidence,
          asicIssuedTotal: stated?.total,
          asicMemberCount: stated?.count,
          asAt: draft.asAt,
          members: memberRows(preparedMembers),
          formerMembers: formerRows(draft.former),
          sourceReference: draft.reference.trim(),
          sourceConfirmed: true,
          correctionOf: correction?.uuid,
          reason: draft.reason.trim(),
        };
      }
      const request = preparation.current;
      const { data } = await prepareRegisterImport(apiClient, request, config(recovering ? check : checkPreparation));
      check();
      if (!isPreparedRegisterImport(data, request))
        throw createUserFriendlyError(REGISTER_IMPORT_COPY.PREPARATION_RECEIPT_FAILED);
      setUncertain(false);
      setProposal(data);
      setPhase('review');
      await client.invalidateQueries({ queryKey: registerKey(owner) });
      check();
      onPrepared(request.tokenId, data.uuid);
    } catch (failure) {
      const status = failureStatus(failure);
      if (status === 400 || status === 404 || status === 409) {
        preparation.current = null;
        setUncertain(false);
        onConflict();
      } else setUncertain(true);
      if (mounted.current)
        setError(
          refusalSentence(failure, REGISTER_IMPORT_UNMET_COPY) ??
            apiErrorSentence(
              failure,
              'The records could not be saved. Retry the same request.',
              'The records could not be confirmed. Recover the original request.',
            ),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const decision = proposal?.stage === 'approved' ? apply : approve;
  const kind = proposal?.stage === 'approved' ? 'apply' : 'approve';
  const currentTarget = decision.target;
  const ready =
    !!currentTarget?.preview.canDecide &&
    currentTarget.uuid === proposal?.uuid &&
    currentTarget.request.kind === kind &&
    currentTarget.request.appointment === steps[kind]?.uuid &&
    proposal?.status === 'submitted' &&
    visible &&
    !blocked;
  const loadPreview = async () => {
    if (!proposal || deciding || recovery || autoApply || blocked || !visible || !steps[kind]) return;
    previewAttempt.current = JSON.stringify([proposal.uuid, proposal.stage, steps[kind]?.uuid]);
    await decision.open(kind);
  };
  useEffect(() => {
    if (
      phase !== 'review' ||
      !proposal ||
      proposal.status !== 'submitted' ||
      busy ||
      deciding ||
      recovery ||
      editing ||
      autoApply ||
      blocked ||
      !visible ||
      !steps[kind]
    )
      return;
    const signature = JSON.stringify([proposal.uuid, proposal.stage, steps[kind]?.uuid]);
    if (previewAttempt.current === signature) return;
    previewAttempt.current = signature;
    void decision.open(kind);
  }, [phase, proposal, busy, deciding, recovery, editing, autoApply, blocked, visible, steps, kind, decision]);
  const preview = apply.target?.preview ?? approve.target?.preview;
  const errors = [error, approve.error, apply.error, reject.error].filter(Boolean);
  return {
    today,
    knownMembers,
    preserveParticulars,
    draft,
    proposal,
    phase,
    setPhase,
    holderEditor,
    setHolderEditor,
    busy,
    uncertain,
    attempted,
    setAttempted,
    autoApply,
    editing,
    setEditing,
    canPrepare,
    finish,
    reject,
    deciding,
    recovery,
    mutable,
    update,
    setMember,
    problems,
    detailProblems,
    holderProblems,
    differs,
    prepare,
    decision,
    kind,
    currentTarget,
    ready,
    loadPreview,
    preview,
    errors,
  } as const;
}

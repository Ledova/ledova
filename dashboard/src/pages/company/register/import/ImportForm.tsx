import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  formatDateToString,
  formatDate,
  formatShareCount,
  isPreparedRegisterImport,
  isRegisterEvidenceReceipt,
  prepareRegisterImport,
  registerImportTotals,
  uploadRegisterEvidence,
  useRegisterDecision,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterEvidenceKind,
  type RegisterImport,
  type RegisterImportPreparation,
  type TokenHoldersResponse,
  type RegisterTransferMember,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { importsKey } from '../useRegisterImports';
import { registerKey } from '../useCompanyRegister';
import type { RegisterSteps } from '../proposals';
import { BringRecords } from './BringRecords';
import { MemberRecords } from './MemberRecords';
import { REGISTER_CSV_MAX_BYTES, readRegisterCsv } from './csv';
import {
  blankMember,
  figuresDiffer,
  formerRows,
  initialMembers,
  memberRows,
  preparationProblems,
  memberIdentityProblems,
  statedFigures,
  type FormerDraft,
  type MemberDraft,
  type PreparationDraft,
} from './preparation';

const CLOSED = 'This setup is closed. Reopen it before continuing.';
const IMPORT_NOTE =
  'Coming soon. Import will read a document into these same editable forms. Review and correct the records before saving.';
type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

export function ImportForm({
  owner,
  guard,
  newEffectGuard = guard,
  company,
  companyName,
  shareClass,
  register,
  appointment,
  steps,
  blocked,
  onConflict,
  correction,
  saved,
  classFields,
  classProblems = [],
  resolveRegister,
  companyMembers,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  newEffectGuard?: () => void;
  company: string;
  companyName?: string;
  shareClass?: { name: string; symbol: string };
  register?: TokenHoldersResponse;
  appointment?: OwnCompanyAppointment;
  steps: RegisterSteps;
  blocked: boolean;
  onConflict: () => void;
  correction?: RegisterImport;
  saved?: RegisterImport;
  classFields?: ReactNode;
  classProblems?: string[];
  resolveRegister?: () => Promise<{ register: TokenHoldersResponse; members: RegisterTransferMember[] }>;
  companyMembers: RegisterTransferMember[];
  visible?: boolean;
  onHeldChange?: (held: boolean) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const importDescription = useId();
  const today = formatDateToString(new Date());
  const [resolvedMembers, setResolvedMembers] = useState<{
    source: RegisterTransferMember[];
    members: RegisterTransferMember[];
  } | null>(null);
  const knownMembers = resolvedMembers?.source === companyMembers ? resolvedMembers.members : companyMembers;
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
    members: register ? initialMembers(register, saved ?? correction) : [blankMember()],
    former: (saved ?? correction)?.formerMembers.map((row) => ({ ...row, id: crypto.randomUUID() })) ?? [],
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
  const uploads = useRef<Partial<Record<RegisterEvidenceKind, Upload>>>({});
  const pending = useRef(false);
  const csvReading = useRef(false);
  const csvGeneration = useRef(0);
  const mounted = useRef(true);
  const currentSteps = useRef(steps);
  const currentPreparation = useRef(appointment);
  const currentContext = useRef({ newEffectGuard, blocked, visible, companyMembers });
  const currentMembers = useRef(knownMembers);
  useLayoutEffect(() => {
    currentSteps.current = steps;
    currentPreparation.current = appointment;
    currentContext.current = { newEffectGuard, blocked, visible, companyMembers };
    currentMembers.current = knownMembers;
  }, [steps, appointment, newEffectGuard, blocked, visible, knownMembers, companyMembers]);
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
    navigate('/company/dashboard', { state: { registerCompany: company } });
  };
  const approve = useRegisterDecision(apiClient, REGISTER_IMPORT_DECISIONS, proposal, {
    appointment: steps.approve?.uuid,
    newKey: () => crypto.randomUUID(),
    guard: check,
    newEffectGuard: () => checkDecision('approve'),
    requestConfig: () => ({ ledovaSubmissionGuard: check }),
    onDecided: (receipt) => {
      setProposal(receipt);
      applyOpened.current = false;
      setAutoPreviewFinished(false);
      setAutoApply(true);
    },
    onRefused: onConflict,
  });
  const apply = useRegisterDecision(apiClient, REGISTER_IMPORT_DECISIONS, proposal, {
    appointment: steps.apply?.uuid,
    newKey: () => crypto.randomUUID(),
    guard: check,
    newEffectGuard: () => checkDecision('apply'),
    requestConfig: () => ({ ledovaSubmissionGuard: check }),
    onDecided: finish,
    onRefused: onConflict,
  });
  const reject = useRegisterDecision(apiClient, REGISTER_IMPORT_DECISIONS, proposal, {
    appointment: steps.reject?.uuid,
    newKey: () => crypto.randomUUID(),
    guard: check,
    newEffectGuard: () => checkDecision('reject'),
    requestConfig: () => ({ ledovaSubmissionGuard: check }),
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
    if (!editing || !reject.target || reject.busy) return;
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
  const setFormer = (index: number, patch: Partial<FormerDraft>) =>
    update((current) => ({
      ...current,
      former: current.former.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    }));
  const problems = [
    ...classProblems,
    ...preparationProblems(draft, today),
    ...memberIdentityProblems(draft.members, knownMembers, preserveParticulars),
  ];
  const detailProblems = problems.filter(
    (problem) =>
      !problem.startsWith('Shareholder') &&
      !problem.startsWith('Add at least') &&
      !problem.startsWith('Each company') &&
      !problem.startsWith('Attach the optional') &&
      !problem.startsWith('Complete any former') &&
      !problem.startsWith('Enter valid whole-number'),
  );
  const holderProblems = (index: number) =>
    problems.filter(
      (problem) =>
        problem.startsWith(`Shareholder ${index + 1}:`) ||
        problem.startsWith(`Shareholder ${index + 1},`) ||
        problem.startsWith('Each company'),
    );
  const differs = figuresDiffer(draft);
  const imported = registerImportTotals(draft.members);
  const upload = async (kind: RegisterEvidenceKind, file: File) => {
    const preparingAppointment = checkPreparation();
    const previous = uploads.current[kind];
    const same = previous?.file === file && previous.appointment === preparingAppointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : crypto.randomUUID();
    uploads.current[kind] = { file, appointment: preparingAppointment.uuid, key, receipt: null };
    const request = { companyId: company, appointment: preparingAppointment.uuid, kind, idempotencyKey: key };
    const { data } = await uploadRegisterEvidence(
      apiClient,
      { ...request, file },
      { ledovaSubmissionGuard: checkPreparation },
    );
    checkPreparation();
    if (!isRegisterEvidenceReceipt(data, request, file.size))
      throw createUserFriendlyError(REGISTER_IMPORT_COPY.UPLOAD_RECEIPT_FAILED);
    uploads.current[kind] = { file, appointment: preparingAppointment.uuid, key, receipt: data };
    return data;
  };
  const importCsv = async (file: File | null) => {
    if (!file || held || !canPrepare || (pending.current && !csvReading.current)) return;
    const generation = ++csvGeneration.current;
    csvReading.current = true;
    pending.current = true;
    setError('');
    setBusy(true);
    try {
      checkPreparation();
      if (file.size > REGISTER_CSV_MAX_BYTES) throw createUserFriendlyError('Choose a UTF-8 CSV no larger than 1 MB.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (generation !== csvGeneration.current) return;
      checkPreparation();
      const preserveMembers = !!correction || register?.initialized === true;
      const known = register ? initialMembers(register, correction) : draft.members;
      const liveMembers = currentMembers.current;
      const candidates = preserveMembers
        ? known
        : liveMembers.length
          ? draft.members.filter(
              (row) => row.identityChoice === 'new' || liveMembers.some((member) => member.member === row.member),
            )
          : draft.members;
      const members = readRegisterCsv(text, candidates, preserveMembers, preserveMembers ? [] : liveMembers);
      const next = { ...draft, members };
      const invalid = preparationProblems(next, today).filter((problem) => problem.startsWith('Shareholder'));
      if (invalid.length) throw createUserFriendlyError(invalid.join(' '));
      setDraft(next);
    } catch (failure) {
      if (mounted.current && generation === csvGeneration.current)
        setError(
          apiErrorSentence(failure, 'The CSV could not be read. Use the template.', 'The CSV could not be read.'),
        );
    } finally {
      if (generation === csvGeneration.current) {
        csvReading.current = false;
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  const prepare = async (recovering = false) => {
    if (pending.current || busy || deciding || (!recovering && holderEditor)) return;
    setAttempted(true);
    if (!recovering && (!canPrepare || blocked || problems.length || differs)) return;
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
        activeRegister.current = current;
        const known = resolved?.members ?? currentMembers.current;
        const sourceAtResolution = currentContext.current.companyMembers;
        if (resolved) setResolvedMembers({ source: sourceAtResolution, members: known });
        const identityProblems = memberIdentityProblems(draft.members, known, preserveParticulars);
        if (identityProblems.length) {
          setUncertain(false);
          setError(identityProblems.join(' '));
          return;
        }
        const registerEvidence = draft.registerFile ? await upload('share_register', draft.registerFile) : null;
        const asicEvidence = draft.asicFile ? await upload('asic_extract', draft.asicFile) : null;
        checkPreparation();
        const changedIdentity = memberIdentityProblems(
          draft.members,
          resolved && currentContext.current.companyMembers === sourceAtResolution ? known : currentMembers.current,
          preserveParticulars,
        );
        if (changedIdentity.length) {
          setUncertain(false);
          setError(changedIdentity.join(' '));
          return;
        }
        const stated = statedFigures(draft);
        preparation.current = {
          operationId: crypto.randomUUID(),
          appointment: preparingAppointment.uuid,
          tokenId: current.token.uuid,
          registerEvidence: registerEvidence?.uuid ?? draft.registerEvidence,
          asicEvidence: asicEvidence?.uuid ?? draft.asicEvidence,
          asicIssuedTotal: stated?.total,
          asicMemberCount: stated?.count,
          asAt: draft.asAt,
          members: memberRows(draft.members),
          formerMembers: formerRows(draft.former),
          sourceReference: draft.reference.trim(),
          sourceConfirmed: true,
          correctionOf: correction?.uuid,
          reason: draft.reason.trim(),
        };
      }
      const request = preparation.current;
      const { data } = await prepareRegisterImport(apiClient, request, {
        ledovaSubmissionGuard: recovering ? check : checkPreparation,
      });
      check();
      if (!isPreparedRegisterImport(data, request))
        throw createUserFriendlyError(REGISTER_IMPORT_COPY.PREPARATION_RECEIPT_FAILED);
      setUncertain(false);
      setProposal(data);
      setPhase('review');
      await client.invalidateQueries({ queryKey: registerKey(owner) });
      check();
      navigate(`${DESTINATIONS.companyRegisterImport.path.replace(':uuid', request.tokenId)}?record=${data.uuid}`, {
        replace: true,
      });
    } catch (failure) {
      const status = failureStatus(failure);
      if (status === 400 || status === 404 || status === 409) {
        preparation.current = null;
        setUncertain(false);
        onConflict();
      } else setUncertain(true);
      if (mounted.current)
        setError(
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
  return (
    <div className="space-y-6">
      {visible && companyName && (
        <p className="text-sm text-text-muted">
          {companyName}
          {shareClass?.name && ` · ${shareClass.name}`}
          {shareClass?.name && shareClass.symbol && ` (${shareClass.symbol})`}
        </p>
      )}
      <ol aria-label="Share register setup steps" className="grid grid-cols-3 gap-3">
        {(['details', 'shareholders', 'review'] as const).map((step, index) => (
          <li
            key={step}
            aria-current={phase === step ? 'step' : undefined}
            className={`flex min-w-0 flex-col gap-2 border-b-2 pb-3 sm:flex-row sm:items-center ${phase === step ? 'border-brand-mid text-text-primary' : 'border-border-subtle text-text-muted'}`}
          >
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${phase === step ? 'bg-brand-mid text-white' : 'bg-surface-tertiary text-text-muted'}`}
            >
              {index + 1}
            </span>
            <span className="text-xs font-medium [overflow-wrap:anywhere] sm:text-sm">
              <span className="sr-only">{index + 1}. </span>
              {step === 'details' ? 'Share details' : step === 'shareholders' ? 'Shareholders' : 'Review'}
            </span>
          </li>
        ))}
      </ol>
      {visible && (
        <>
          {mutable ? (
            canPrepare ? (
              <form
                className="space-y-6 rounded-2xl border border-border bg-surface-raised p-4 sm:p-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (phase === 'details') {
                    setAttempted(true);
                    if (!detailProblems.length && !blocked) {
                      setAttempted(false);
                      setPhase('shareholders');
                    }
                  } else if (!holderEditor) void prepare();
                }}
              >
                <h2 className="font-display text-xl text-text-primary">
                  {phase === 'details' ? 'Share details' : 'Shareholders'}
                </h2>
                <fieldset
                  disabled={busy || uncertain || blocked}
                  className={phase === 'details' ? 'grid items-start gap-6 md:grid-cols-2' : 'space-y-5'}
                >
                  {phase === 'details' &&
                    (classFields ??
                      (register && (
                        <Rows>
                          <Row label="Share class">{register.token.name}</Row>
                          <Row label="Class code">{register.token.symbol}</Row>
                        </Rows>
                      )))}
                  <BringRecords
                    draft={draft}
                    today={today}
                    correction={!!correction}
                    preserveMembers={!!correction || register?.initialized === true}
                    busy={busy}
                    differs={differs}
                    imported={imported}
                    update={update}
                    setMember={setMember}
                    setFormer={setFormer}
                    importCsv={importCsv}
                    companyMembers={knownMembers}
                    preserveParticulars={preserveParticulars}
                    step={phase === 'details' ? 'details' : 'shareholders'}
                    validateMember={holderProblems}
                    onEditorChange={setHolderEditor}
                  />
                </fieldset>
                {attempted && (phase === 'details' ? detailProblems : problems).length > 0 && (
                  <ul role="alert" className="space-y-1 text-sm text-error-light">
                    {(phase === 'details' ? detailProblems : problems).map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
                {!uncertain && !holderEditor && (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-4">
                    {phase === 'shareholders' && (
                      <PageAction
                        label="Back to share details"
                        disabled={busy || blocked || holderEditor}
                        onClick={() => {
                          setAttempted(false);
                          setPhase('details');
                        }}
                      />
                    )}
                    <PageAction
                      label={phase === 'details' ? 'Continue' : busy ? 'Saving draft…' : 'Save draft and review'}
                      primary
                      disabled={busy || blocked || holderEditor}
                      onClick={() => {
                        if (phase === 'details') {
                          setAttempted(true);
                          if (!detailProblems.length) {
                            setAttempted(false);
                            setPhase('shareholders');
                          }
                        } else void prepare();
                      }}
                    />
                    {phase === 'details' && (
                      <>
                        <button
                          type="button"
                          aria-disabled="true"
                          aria-describedby={importDescription}
                          title={IMPORT_NOTE}
                          className="inline-flex rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-text-muted opacity-60"
                        >
                          Import
                        </button>
                        <span id={importDescription} className="sr-only">
                          {IMPORT_NOTE}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </form>
            ) : (
              <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>
            )
          ) : (
            proposal && (
              <section
                aria-label={proposal.status === 'applied' ? 'Recorded share register' : 'Review share register'}
                className="space-y-6 rounded-2xl border border-border bg-surface-raised p-4 sm:p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-xl text-text-primary">
                    {proposal.status === 'applied' ? 'Recorded' : 'Review'}
                  </h2>
                  <p className="text-sm text-text-muted">
                    Record date · <time dateTime={proposal.asAt}>{formatDate(proposal.asAt)}</time>
                  </p>
                </div>
                <dl aria-label="Share register summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="col-span-2 min-w-0 rounded-xl bg-surface-tertiary p-4 sm:col-span-1">
                    <dt className="text-xs text-text-muted">Share class</dt>
                    <dd className="mt-2 break-words text-lg font-medium text-text-primary">
                      {shareClass?.name ?? register?.token.name ?? 'Share class'}
                    </dd>
                    <dd className="mt-1 text-xs text-text-muted">{shareClass?.symbol ?? register?.token.symbol}</dd>
                  </div>
                  <div className="min-w-0 rounded-xl bg-surface-tertiary p-4">
                    <dt className="text-xs text-text-muted">Shares held</dt>
                    <dd className="mt-2 break-words text-2xl font-medium tabular-nums text-text-primary">
                      {formatShareCount(registerImportTotals(proposal.members).total)}
                    </dd>
                  </div>
                  <div className="min-w-0 rounded-xl bg-surface-tertiary p-4">
                    <dt className="text-xs text-text-muted">Shareholders</dt>
                    <dd className="mt-2 text-2xl font-medium tabular-nums text-text-primary">
                      {proposal.members.length}
                    </dd>
                  </div>
                </dl>
                {proposal.correctionOf && <p className="text-sm text-text-muted">Correction: {proposal.reason}</p>}
                {((proposal.sourceReference || proposal.authorityReference) !== 'Company-provided share records' ||
                  proposal.asicIssuedTotal !== null ||
                  proposal.asicMemberCount !== null ||
                  proposal.registerEvidence ||
                  proposal.asicEvidence) && (
                  <details className="rounded-xl border border-border-subtle p-3">
                    <summary className="cursor-pointer text-sm text-text-muted">Supporting records</summary>
                    <dl className="grid gap-4 pt-4 sm:grid-cols-2">
                      {(proposal.sourceReference || proposal.authorityReference) !==
                        'Company-provided share records' && (
                        <div>
                          <dt className="text-xs text-text-muted">Source record</dt>
                          <dd className="mt-1 text-sm">{proposal.sourceReference || proposal.authorityReference}</dd>
                        </div>
                      )}
                      {proposal.asicIssuedTotal !== null && (
                        <div>
                          <dt className="text-xs text-text-muted">ASIC issued shares cross-check</dt>
                          <dd className="mt-1 text-sm">{formatShareCount(proposal.asicIssuedTotal)}</dd>
                        </div>
                      )}
                      {proposal.asicMemberCount !== null && (
                        <div>
                          <dt className="text-xs text-text-muted">Shareholders listed by ASIC</dt>
                          <dd className="mt-1 text-sm">{proposal.asicMemberCount}</dd>
                        </div>
                      )}
                      {proposal.registerEvidence && (
                        <div>
                          <dt className="text-xs text-text-muted">Source copy</dt>
                          <dd className="mt-1 text-sm">Retained company-provided register copy</dd>
                        </div>
                      )}
                      {proposal.asicEvidence && (
                        <div>
                          <dt className="text-xs text-text-muted">ASIC copy</dt>
                          <dd className="mt-1 text-sm">Retained company-provided extract</dd>
                        </div>
                      )}
                    </dl>
                  </details>
                )}
                <MemberRecords members={proposal.members} />
                {!!proposal.formerMembers.length && (
                  <ul className="divide-y divide-border-subtle">
                    {proposal.formerMembers.map((member, index) => (
                      <li key={index} className="py-3">
                        <Rows>
                          <Row label="Former shareholder">{member.name}</Row>
                          <Row label="Address">{member.residentialAddress}</Row>
                          <Row label="Shares at cessation">{formatShareCount(member.shares)}</Row>
                          <Row label="Ceased on">{member.ceasedOn}</Row>
                        </Rows>
                      </li>
                    ))}
                  </ul>
                )}
                {proposal.status === 'submitted' && canPrepare && steps.reject && (
                  <p className="text-xs text-text-muted">
                    Editing retires this prepared draft before saving a replacement. Confirmed mirrors and earlier
                    evidence stay unchanged.
                  </p>
                )}
                {proposal.status === 'submitted' && !steps[kind] && (
                  <p className="text-sm text-text-muted">
                    {kind === 'apply'
                      ? 'These records are reviewed. A company appointee with confirmation access must confirm the mirror before ownership is recorded.'
                      : 'These records are saved. A company appointee with review access must review them before confirmation.'}
                  </p>
                )}
                {proposal.status === 'submitted' && (
                  <>
                    <p className="text-sm text-text-primary">
                      {REGISTER_IMPORT_COPY.SOURCE_CONFIRMATION} Confirming this mirror does not issue shares or change
                      the legal register.
                    </p>
                    {proposal.correctionOf && preview && (
                      <table className="w-full text-sm">
                        <caption className="pb-2 text-left text-text-muted">
                          Correction compared with the current mirror
                        </caption>
                        <thead>
                          <tr>
                            <th className="text-left">Shareholder</th>
                            <th className="text-right">Before</th>
                            <th className="text-right">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.comparison.map((row) => (
                            <tr key={row.member}>
                              <th className="py-2 text-left font-normal">
                                {row.name ?? row.liveName ?? 'Earlier shareholder'}
                              </th>
                              <td className="text-right">
                                {row.stored === null ? 'Not held' : formatShareCount(row.stored)}
                                <p className="text-xs text-text-muted">{row.enteredOn ?? 'Not recorded'}</p>
                              </td>
                              <td className="text-right">
                                {row.imported === null ? 'Not held' : formatShareCount(row.imported)}
                                <p className="text-xs text-text-muted">{row.importedEnteredOn ?? 'Not recorded'}</p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {preview?.unmetRequirements.length ? (
                      <ul role="alert" className="space-y-1 text-sm text-error-light">
                        {preview.unmetRequirements.map((code) => (
                          <li key={code}>{REGISTER_IMPORT_DECISIONS.unmet[code] ?? code}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-4">
                      <PageAction
                        label="Edit records"
                        disabled={deciding || !!recovery || autoApply || !canPrepare || !steps.reject || blocked}
                        onClick={() => {
                          setEditing(true);
                          void reject.open('reject', 'Replaced while editing the copied records.');
                        }}
                      />
                      {!currentTarget && !recovery && (
                        <PageAction
                          label={deciding ? 'Loading confirmation…' : 'Load confirmation'}
                          disabled={deciding || busy || autoApply || blocked || !steps[kind]}
                          onClick={() => void loadPreview()}
                        />
                      )}
                      {!recovery && (
                        <PageAction
                          label={
                            deciding ? 'Confirming…' : kind === 'approve' && !steps.apply ? 'Record review' : 'Confirm'
                          }
                          primary
                          disabled={deciding || !ready || autoApply}
                          onClick={() => void decision.confirm()}
                        />
                      )}
                    </div>
                  </>
                )}
                {proposal.status === 'applied' && (
                  <div className="flex justify-end border-t border-border-subtle pt-4">
                    <PageAction label="View company ownership" primary onClick={() => void finish()} />
                  </div>
                )}
              </section>
            )
          )}
        </>
      )}
      {uncertain && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The save result is uncertain. Keep the original details and recover the same request.
          </p>
          <PageAction label="Recover saved records" disabled={busy} onClick={() => void prepare(true)} />
        </div>
      )}
      {recovery && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The confirmation result is uncertain. Recover the original request before continuing.
          </p>
          <PageAction label="Recover confirmation" disabled={deciding} onClick={() => void recovery.recover()} />
        </div>
      )}
      {errors.map((message, index) => (
        <p key={index} role="alert" className="text-sm text-error-light">
          {message}
        </p>
      ))}
      {!visible && (
        <p className="text-sm text-text-muted">
          Refresh current company access before showing these records or starting another action.
        </p>
      )}
    </div>
  );
}

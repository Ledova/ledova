import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  statedFigures,
  type FormerDraft,
  type MemberDraft,
  type PreparationDraft,
} from './preparation';

const CLOSED = 'This setup is closed. Reopen it before continuing.';
type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

export function ImportForm({
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
  classFields,
  classProblems = [],
  resolveRegister,
  visible = true,
  onHeldChange,
}: {
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
  classFields?: ReactNode;
  classProblems?: string[];
  resolveRegister?: () => Promise<TokenHoldersResponse>;
  visible?: boolean;
  onHeldChange?: (held: boolean) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = formatDateToString(new Date());
  const reuseSavedCopies = !!saved?.preparingAppointment && saved.preparingAppointment === appointment?.uuid;
  const [draft, setDraft] = useState<PreparationDraft>(() => ({
    registerFile: null,
    asicFile: null,
    registerEvidence: reuseSavedCopies ? (saved?.registerEvidence ?? undefined) : undefined,
    asicEvidence: reuseSavedCopies ? (saved?.asicEvidence ?? undefined) : undefined,
    earlierCopiesNotReused: !reuseSavedCopies && !!(saved?.registerEvidence || saved?.asicEvidence),
    asAt: saved?.asAt ?? correction?.asAt ?? today,
    reference: saved?.sourceReference ?? correction?.sourceReference ?? '',
    reason: saved?.reason ?? (correction ? '' : 'Mirror the company’s existing share records.'),
    members: register ? initialMembers(register, saved ?? correction) : [blankMember()],
    former: (saved ?? correction)?.formerMembers.map((row) => ({ ...row, id: crypto.randomUUID() })) ?? [],
    statedTotal: saved?.asicIssuedTotal ?? '',
    statedCount: saved?.asicMemberCount?.toString() ?? '',
  }));
  const [proposal, setProposal] = useState<RegisterImport | undefined>(
    saved?.status === 'rejected' ? undefined : saved,
  );
  const [phase, setPhase] = useState<'bring' | 'review' | 'confirm'>(
    saved && saved.status !== 'rejected' ? 'review' : 'bring',
  );
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [autoApply, setAutoApply] = useState(false);
  const [autoPreviewFinished, setAutoPreviewFinished] = useState(false);
  const [editing, setEditing] = useState(false);
  const applyOpened = useRef(false);
  const preparation = useRef<RegisterImportPreparation | null>(null);
  const activeRegister = useRef(register);
  const uploads = useRef<Partial<Record<RegisterEvidenceKind, Upload>>>({});
  const pending = useRef(false);
  const csvReading = useRef(false);
  const csvGeneration = useRef(0);
  const mounted = useRef(true);
  const currentSteps = useRef(steps);
  const currentPreparation = useRef(appointment);
  const currentContext = useRef({ newEffectGuard, blocked, visible });
  useLayoutEffect(() => {
    currentSteps.current = steps;
    currentPreparation.current = appointment;
    currentContext.current = { newEffectGuard, blocked, visible };
  }, [steps, appointment, newEffectGuard, blocked, visible]);
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
      setPhase('bring');
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
    void apply.open('apply').finally(() => setAutoPreviewFinished(true));
  }, [autoApply, approve.busy, apply.busy, apply, proposal?.stage, steps.apply]);
  useEffect(() => {
    if (!autoApply || !autoPreviewFinished || apply.busy) return;
    if (apply.target?.preview.canDecide) void apply.confirm().finally(() => setAutoApply(false));
    else void Promise.resolve().then(() => setAutoApply(false));
  }, [autoApply, autoPreviewFinished, apply]);
  const deciding = approve.busy || apply.busy || reject.busy;
  const recovery = approve.recovery ? approve : apply.recovery ? apply : reject.recovery ? reject : null;
  const held = busy || uncertain || deciding || !!recovery || phase !== 'bring';
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
  const problems = [...classProblems, ...preparationProblems(draft, today)];
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
      const members = readRegisterCsv(text, preserveMembers ? known : draft.members, preserveMembers);
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
    if (pending.current || busy || deciding) return;
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
        const current = activeRegister.current ?? (await resolveRegister?.());
        checkPreparation();
        if (!current) throw createUserFriendlyError('Choose the share class before continuing.');
        activeRegister.current = current;
        const registerEvidence = draft.registerFile ? await upload('share_register', draft.registerFile) : null;
        const asicEvidence = draft.asicFile ? await upload('asic_extract', draft.asicFile) : null;
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
  const review = async () => {
    if (!proposal || deciding || blocked || !steps[proposal.stage === 'approved' ? 'apply' : 'approve']) return;
    setPhase('confirm');
    if (proposal.stage === 'approved') await apply.open('apply');
    else await approve.open('approve');
  };
  const decision = proposal?.stage === 'approved' ? apply : approve;
  const kind = proposal?.stage === 'approved' ? 'apply' : 'approve';
  const currentTarget = decision.target;
  const ready =
    !!currentTarget?.preview.canDecide && currentTarget.request.appointment === steps[kind]?.uuid && !blocked;
  const preview = apply.target?.preview ?? approve.target?.preview;
  const errors = [error, approve.error, apply.error, reject.error].filter(Boolean);
  return (
    <div className="space-y-5">
      <ol
        aria-label="Share register setup steps"
        className="grid grid-cols-3 gap-2 border-b border-border-subtle pb-4 text-sm"
      >
        {(['bring', 'review', 'confirm'] as const).map((step, index) => (
          <li
            key={step}
            aria-current={phase === step ? 'step' : undefined}
            className={phase === step ? 'font-medium text-text-primary' : 'text-text-muted'}
          >
            {index + 1}. {step === 'bring' ? 'Bring records' : step === 'review' ? 'Review' : 'Confirm'}
          </li>
        ))}
      </ol>
      {visible && (
        <>
          {phase === 'bring' ? (
            canPrepare ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void prepare();
                }}
              >
                <fieldset disabled={busy || uncertain || blocked} className="space-y-5">
                  {classFields}
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
                  />
                </fieldset>
                {attempted && problems.length > 0 && (
                  <ul role="alert" className="space-y-1 text-sm text-error-light">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
                {!uncertain && (
                  <PageAction
                    label={busy ? 'Saving records…' : 'Continue to review'}
                    disabled={busy || blocked}
                    onClick={() => void prepare()}
                  />
                )}
              </form>
            ) : (
              <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>
            )
          ) : (
            proposal && (
              <div className="space-y-4">
                <Rows>
                  <Row label="Source record">{proposal.sourceReference || proposal.authorityReference}</Row>
                  <Row label="Record date">{proposal.asAt}</Row>
                  <Row label="Copied shares">{formatShareCount(registerImportTotals(proposal.members).total)}</Row>
                  <Row label="Shareholders">{proposal.members.length}</Row>
                  {!!proposal.formerMembers.length && (
                    <Row label="Copied former shareholders">{proposal.formerMembers.length}</Row>
                  )}
                  {proposal.asicIssuedTotal !== null && (
                    <Row label="ASIC issued shares cross-check">{formatShareCount(proposal.asicIssuedTotal)}</Row>
                  )}
                  {proposal.asicMemberCount !== null && (
                    <Row label="Shareholders listed by ASIC">{proposal.asicMemberCount}</Row>
                  )}
                  {proposal.registerEvidence && <Row label="Source copy">Retained company-provided register copy</Row>}
                  {proposal.asicEvidence && <Row label="ASIC copy">Retained company-provided extract</Row>}
                  {proposal.correctionOf && <Row label="Correction reason">{proposal.reason}</Row>}
                </Rows>
                {phase === 'review' && <MemberRecords members={proposal.members} />}
                {phase === 'review' && !!proposal.formerMembers.length && (
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
                {phase === 'review' && canPrepare && steps.reject && (
                  <p className="text-xs text-text-muted">
                    Editing retires this prepared draft before saving a replacement. Confirmed mirrors and earlier
                    evidence stay unchanged.
                  </p>
                )}
                {phase === 'review' && (
                  <div className="flex flex-wrap gap-2">
                    <PageAction
                      label="Edit records"
                      disabled={deciding || !canPrepare || !steps.reject || blocked || proposal.status !== 'submitted'}
                      onClick={() => {
                        setEditing(true);
                        void reject.open('reject', 'Replaced while editing the copied records.');
                      }}
                    />
                    <PageAction
                      label="Continue to confirmation"
                      disabled={deciding || blocked || !steps[kind] || proposal.status !== 'submitted'}
                      onClick={() => void review()}
                    />
                  </div>
                )}
                {phase === 'review' && proposal.status === 'submitted' && !steps[kind] && (
                  <p className="text-sm text-text-muted">
                    {kind === 'apply'
                      ? 'These records are reviewed. A company appointee with confirmation access must confirm the mirror before ownership is recorded.'
                      : 'These records are saved. A company appointee with review access must review them before confirmation.'}
                  </p>
                )}
                {phase === 'confirm' && (
                  <>
                    <p className="text-sm text-text-primary">
                      {REGISTER_IMPORT_COPY.SOURCE_CONFIRMATION} Confirming this mirror does not issue shares or change
                      the legal register.
                    </p>
                    {proposal.stage === 'approved' && !steps.apply && (
                      <p className="text-sm text-text-muted">
                        These records are reviewed. A company appointee with confirmation access must confirm the mirror
                        before ownership is recorded.
                      </p>
                    )}
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
                    <div className="flex flex-wrap gap-2">
                      <PageAction
                        label="Back to review"
                        disabled={deciding || !!recovery}
                        onClick={() => {
                          approve.cancel();
                          apply.cancel();
                          setAutoApply(false);
                          setPhase('review');
                        }}
                      />
                      {!currentTarget && !recovery && (
                        <PageAction
                          label={deciding ? 'Loading confirmation…' : 'Load confirmation'}
                          disabled={deciding || blocked || !steps[kind]}
                          onClick={() => void review()}
                        />
                      )}
                      {!recovery && (
                        <PageAction
                          label={
                            deciding
                              ? 'Confirming…'
                              : kind === 'approve' && !steps.apply
                                ? 'Record review'
                                : 'Confirm mirror'
                          }
                          disabled={deciding || !ready || autoApply}
                          onClick={() => void decision.confirm()}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
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
      {proposal?.status === 'applied' && <PageAction label="View company ownership" onClick={() => void finish()} />}
    </div>
  );
}

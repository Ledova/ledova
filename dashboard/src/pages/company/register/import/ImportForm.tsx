import { useImportPreparation, type ImportFormProps } from './useImportPreparation';
import { useRunningAction } from '@hooks/useRunningAction';

import {
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  formatDate,
  formatShareCount,
  registerImportTotals,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';

import { BringRecords } from './BringRecords';
import { MemberRecords } from '@pages/company/register/shared/MemberRecords';

const IMPORT_NOTE =
  'Coming soon. Import will read a document into these same editable forms. Review and correct the records before saving.';

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
  awardRecipients,
  emptyOpeningAllowed = false,
  visible = true,
  onHeldChange,
}: ImportFormProps) {
  const { running, track } = useRunningAction();
  const {
    importDescription,
    today,
    knownMembers,
    knownAwardRecipients,
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
    setFormer,
    problems,
    detailProblems,
    holderProblems,
    differs,
    imported,
    prepare,
    decision,
    kind,
    currentTarget,
    ready,
    loadPreview,
    preview,
    errors,
  } = useImportPreparation({
    owner,
    guard,
    newEffectGuard,
    company,
    register,
    appointment,
    steps,
    blocked,
    onConflict,
    correction,
    saved,
    classProblems,
    resolveRegister,
    companyMembers,
    awardRecipients,
    emptyOpeningAllowed,
    visible,
    onHeldChange,
  });

  return (
    <div className="space-y-6">
      {visible && companyName && (
        <p className="text-sm text-text-muted">
          {companyName}
          {shareClass?.name && ` · ${shareClass.name}`}
          {shareClass?.name && shareClass.symbol && ` (${shareClass.symbol})`}
        </p>
      )}
      {(!visible || proposal?.status !== 'applied') && (
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
      )}
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
                    busy={busy}
                    differs={differs}
                    imported={imported}
                    update={update}
                    setMember={setMember}
                    setFormer={setFormer}
                    companyMembers={knownMembers}
                    awardRecipients={knownAwardRecipients}
                    preserveParticulars={preserveParticulars}
                    step={phase === 'details' ? 'details' : 'shareholders'}
                    validateMember={holderProblems}
                    onEditorChange={setHolderEditor}
                  />
                  {phase === 'shareholders' && emptyOpeningAllowed && !correction && draft.members.length === 0 && (
                    <p className="text-sm text-text-muted">
                      If no shares have been issued, continue with no shareholders. Confirming records an empty opening;
                      the first share issue is a separate company decision.
                    </p>
                  )}
                </fieldset>
                {attempted && (phase === 'details' ? detailProblems : problems).length > 0 && (
                  <ul role="alert" className="space-y-1 text-sm text-error-light">
                    {(phase === 'details' ? detailProblems : problems).map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
                {!uncertain && !holderEditor && (
                  <FormActions>
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
                    <PageAction
                      type="submit"
                      label={phase === 'details' ? 'Continue' : 'Save draft and review'}
                      primary
                      busy={phase === 'shareholders' && busy}
                      busyLabel="Saving draft…"
                      disabled={busy || blocked || holderEditor}
                    />
                  </FormActions>
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
                                <p className="text-xs text-text-muted">{formatDate(row.enteredOn, 'Not recorded')}</p>
                              </td>
                              <td className="text-right">
                                {row.imported === null ? 'Not held' : formatShareCount(row.imported)}
                                <p className="text-xs text-text-muted">
                                  {formatDate(row.importedEnteredOn, 'Not recorded')}
                                </p>
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
                    <FormActions>
                      <PageAction
                        label="Edit records"
                        busy={editing}
                        busyLabel="Reopening records…"
                        disabled={deciding || !!recovery || autoApply || !canPrepare || !steps.reject || blocked}
                        onClick={() => {
                          setEditing(true);
                          void reject.open('reject', 'Replaced while editing the copied records.');
                        }}
                      />
                      {!currentTarget && !recovery && (
                        <PageAction
                          label="Load confirmation"
                          busy={running === 'load'}
                          busyLabel="Loading confirmation…"
                          disabled={busy || deciding || autoApply || blocked || !steps[kind]}
                          onClick={() => track('load', loadPreview())}
                        />
                      )}
                      {!recovery && (
                        <PageAction
                          label={kind === 'approve' && !steps.apply ? 'Record review' : 'Confirm'}
                          busy={running === 'confirm' || (autoApply && deciding)}
                          busyLabel="Confirming…"
                          primary
                          disabled={!ready || deciding || autoApply}
                          onClick={() => track('confirm', decision.confirm())}
                        />
                      )}
                    </FormActions>
                  </>
                )}
                {proposal.status === 'applied' && (
                  <FormActions>
                    <PageAction
                      label="View company ownership"
                      primary
                      busy={running === 'finish'}
                      busyLabel="Opening company ownership…"
                      onClick={() => track('finish', finish())}
                    />
                  </FormActions>
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

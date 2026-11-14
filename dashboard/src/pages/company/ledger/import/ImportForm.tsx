import { useRunningAction } from '@hooks/useRunningAction';
import { COMPANY_DASHBOARD_PATH } from '@utils/paths';
import { generatePath, useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  REGISTER_SETUP_STEPS,
  formatDate,
  formatShareCount,
  formatShortDate,
  registerImportTotals,
  refusalSentences,
  shareCount,
  useImportPreparation,
  type ImportPreparationOptions,
} from '@ledova/shared';
import { Row, Rows, ShowMore, Section, Status, Failure } from '@components/Ledger';
import { Table } from '@components/List';
import { FormActions, PageAction } from '@components/Page';
import { FormSteps } from '@components/FormSteps';
import { ErrorSummary } from '@components/ErrorSummary';
import { useId, useRef, useState, type ReactNode } from 'react';

import { BringRecords } from './BringRecords';
import { MemberRecords, MemberRow } from '@pages/company/ledger/shared/MemberRecords';

const IMPORT_NOTE =
  'Coming soon. Import will read a document into these same editable forms. Review and correct the records before saving.';

type ImportFormProps = Omit<ImportPreparationOptions, 'onPrepared' | 'onFinished' | 'newKey' | 'session'> & {
  shareClass?: { name: string; symbol: string };
  classFields?: ReactNode;
};

export function ImportForm({
  owner,
  guard,
  newEffectGuard = guard,
  company,
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
  emptyOpeningAllowed = false,
  visible = true,
  onHeldChange,
}: ImportFormProps) {
  const { running, track } = useRunningAction();
  const navigate = useNavigate();
  const importDescription = useId();
  const [tries, setTries] = useState(0);
  const focusedTry = useRef(0);
  const {
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
    emptyOpeningAllowed,
    visible,
    onHeldChange,
    newKey: () => crypto.randomUUID(),
    onPrepared: (token, record) =>
      navigate(`${generatePath(DESTINATIONS.companyRegisterImport.path, { uuid: token })}?record=${record}`, {
        replace: true,
      }),
    onFinished: () => navigate(COMPANY_DASHBOARD_PATH, { state: { registerCompany: company } }),
  });

  const title =
    [shareClass?.name ?? register?.token.name, shareClass?.symbol ?? register?.token.symbol]
      .filter(Boolean)
      .join(' · ') || 'New share class';

  return (
    <Section title={title}>
      {(!visible || proposal?.status !== 'applied') && (
        <FormSteps label="Ledger setup steps" steps={REGISTER_SETUP_STEPS} current={phase} />
      )}
      {visible && (
        <>
          {mutable ? (
            canPrepare ? (
              <form
                className="space-y-5"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  setTries((count) => count + 1);
                  if (phase === 'details') {
                    setAttempted(true);
                    if (!detailProblems.length && !blocked) {
                      setAttempted(false);
                      setPhase('shareholders');
                    }
                  } else if (!holderEditor) void prepare();
                }}
              >
                <ErrorSummary
                  attempt={tries}
                  claim={(count) => count > focusedTry.current && (focusedTry.current = count) === count}
                  problems={
                    attempted ? (phase === 'details' ? detailProblems : problems).map((message) => ({ message })) : []
                  }
                />
                <fieldset
                  disabled={busy || uncertain || blocked}
                  className={
                    phase === 'details' ? 'grid min-w-0 items-start gap-6 md:grid-cols-2' : 'min-w-0 space-y-5'
                  }
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
                    update={update}
                    setMember={setMember}
                    companyMembers={knownMembers}
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
                {!uncertain && !holderEditor && (
                  <FormActions>
                    {phase === 'shareholders' && (
                      <PageAction
                        label="Back"
                        context="share details"
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
                aria-label={proposal.status === 'applied' ? 'Recorded ledger' : 'Review ledger'}
                className="space-y-5"
              >
                {proposal.status === 'applied' && (
                  <p className="text-sm text-text-primary">
                    <Status tone="done">Recorded</Status>
                  </p>
                )}
                <Rows>
                  <Row label="Record date" inline>
                    <time dateTime={proposal.asAt}>{formatShortDate(proposal.asAt)}</time>
                  </Row>
                  <Row label="Shares held" inline>
                    {formatShareCount(registerImportTotals(proposal.members).total)}
                  </Row>
                  <Row label="Shareholders" inline>
                    {proposal.members.length}
                  </Row>
                </Rows>
                {proposal.correctionOf && <p className="text-sm text-text-muted">Correction: {proposal.reason}</p>}
                {((proposal.sourceReference || proposal.authorityReference) !== 'Company-provided share records' ||
                  proposal.asicIssuedTotal !== null ||
                  proposal.asicMemberCount !== null ||
                  proposal.registerEvidence ||
                  proposal.asicEvidence) && (
                  <ShowMore show="Show supporting records" hide="Hide supporting records">
                    <Rows>
                      {(proposal.sourceReference || proposal.authorityReference) !==
                        'Company-provided share records' && (
                        <Row label="Source record" inline>
                          {proposal.sourceReference || proposal.authorityReference}
                        </Row>
                      )}
                      {proposal.asicIssuedTotal !== null && (
                        <Row label="ASIC issued shares cross-check" inline>
                          {formatShareCount(proposal.asicIssuedTotal)}
                        </Row>
                      )}
                      {proposal.asicMemberCount !== null && (
                        <Row label="Shareholders listed by ASIC" inline>
                          {proposal.asicMemberCount}
                        </Row>
                      )}
                      {proposal.registerEvidence && (
                        <Row label="Source copy" inline>
                          Retained company-provided register copy
                        </Row>
                      )}
                      {proposal.asicEvidence && (
                        <Row label="ASIC copy" inline>
                          Retained company-provided extract
                        </Row>
                      )}
                    </Rows>
                  </ShowMore>
                )}
                <MemberRecords members={proposal.members} />
                {!!proposal.formerMembers.length && (
                  <ul aria-label="Former shareholders" className="divide-y divide-border-subtle">
                    {proposal.formerMembers.map((member, index) => (
                      <MemberRow
                        key={index}
                        name={member.name}
                        shares={shareCount(member.shares)}
                        address={member.residentialAddress}
                        facts={`Former shareholder · Ceased ${formatShortDate(member.ceasedOn)}`}
                      />
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
                    {proposal.correctionOf && preview && (
                      <>
                        <p aria-hidden="true" className="text-sm text-text-muted">
                          Correction compared with the current mirror
                        </p>
                        <Table
                          caption="Correction compared with the current mirror"
                          columns={[
                            { label: 'Shareholder' },
                            { label: 'Before', align: 'right' },
                            { label: 'After', align: 'right' },
                          ]}
                        >
                          {preview.comparison.map((row) => (
                            <tr key={row.member}>
                              <th scope="row" className="px-4 py-3 text-left font-normal">
                                {row.name ?? row.liveName ?? 'Earlier shareholder'}
                              </th>
                              <td className="px-4 py-3 text-right tabular-nums">
                                {row.stored === null ? 'Not held' : formatShareCount(row.stored)}
                                <p className="text-xs text-text-muted">{formatDate(row.enteredOn, 'Not recorded')}</p>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                {row.imported === null ? 'Not held' : formatShareCount(row.imported)}
                                <p className="text-xs text-text-muted">
                                  {formatDate(row.importedEnteredOn, 'Not recorded')}
                                </p>
                              </td>
                            </tr>
                          ))}
                        </Table>
                      </>
                    )}
                    {preview?.unmetRequirements.length ? (
                      <ul role="alert" className="space-y-1 text-sm text-error-light">
                        {refusalSentences(preview.unmetRequirements, REGISTER_IMPORT_DECISIONS.unmet).map(
                          (sentence) => (
                            <li key={sentence}>{sentence}</li>
                          ),
                        )}
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
                          busy={running !== 'confirm' && decision.busy && !autoApply}
                          busyLabel="Loading confirmation…"
                          disabled={busy || deciding || autoApply || blocked || !steps[kind]}
                          onClick={() => void loadPreview()}
                        />
                      )}
                      {(!recovery || deciding) && (
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
      {recovery && !deciding && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The confirmation result is uncertain. Recover the original request before continuing.
          </p>
          <PageAction label="Recover confirmation" disabled={deciding} onClick={() => void recovery.recover()} />
        </div>
      )}
      {errors.map((message, index) => (
        <Failure key={index}>{message}</Failure>
      ))}
      {!visible && (
        <p className="text-sm text-text-muted">
          Refresh current company access before showing these records or starting another action.
        </p>
      )}
    </Section>
  );
}

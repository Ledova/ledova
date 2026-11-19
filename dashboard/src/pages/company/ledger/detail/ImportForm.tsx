import { useRunningAction } from '@hooks/useRunningAction';
import { COMPANY_DASHBOARD_PATH } from '@utils/paths';
import { useNavigate } from 'react-router-dom';
import {
  FIELD_LIMITS,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  REGISTER_SETUP_STEPS,
  formatDate,
  formatShareCount,
  formatShortDate,
  hasSupportingRecords,
  importSourceRecord,
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
import { Field, TextArea, TextInput } from '@components/Field';
import { useId, useRef, useState, type ReactNode } from 'react';

import { BringRecords } from './BringRecords';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';
import { MemberRecords, MemberRow } from '@pages/company/ledger/shared/MemberRecords';

const IMPORT_NOTE =
  'Coming soon. Import will read a document into these same editable forms. Review and correct the records before saving.';

type ImportFormProps = Omit<ImportPreparationOptions, 'onFinished' | 'newKey' | 'session'> & {
  shareClass?: { name: string; symbol: string; type?: string };
  classFields?: ReactNode;
  classDetails?: (recordFields: ReactNode) => ReactNode;
  classActions?: ReactNode;
  classContent: ReactNode;
  classReview: ReactNode;
  classContentHeld?: boolean;
  classHeld?: boolean;
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
  classDetails,
  classActions,
  classContent,
  classReview,
  classContentHeld = false,
  classHeld = false,
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
  const preparationFormId = useId();
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
    goTo,
    stepReachable,
    holderEditor,
    setHolderEditor,
    busy,
    uncertain,
    attempted,
    setAttempted,
    autoApply,
    editing,
    canPrepare,
    finish,
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
    onFinished: () => navigate(COMPANY_DASHBOARD_PATH, { state: { registerCompany: company } }),
  });

  const source = proposal ? importSourceRecord(proposal) : null;
  const recordFields = (
    <fieldset
      hidden={!canPrepare}
      disabled={!canPrepare || busy || uncertain || blocked || classHeld || classContentHeld}
      className="space-y-3"
    >
      <legend className="sr-only">Record date</legend>
      <Field label="Record date">
        <TextInput
          form={preparationFormId}
          type="date"
          max={today}
          value={draft.asAt}
          onChange={(event) => update((current) => ({ ...current, asAt: event.target.value }))}
        />
      </Field>
      {correction && (
        <>
          <Field label="Reason for correcting the mirror">
            <TextArea
              form={preparationFormId}
              rows={2}
              value={draft.reason}
              maxLength={FIELD_LIMITS.REASON}
              onChange={(event) => update((current) => ({ ...current, reason: event.target.value }))}
            />
          </Field>
          <p className="text-sm text-text-muted">
            This corrects a copied opening. The earlier snapshot and evidence remain in history. It does not change the
            company’s legal records.
          </p>
        </>
      )}
    </fieldset>
  );
  const continueAction = (
    <PageAction
      {...(phase === 'rights'
        ? {
            onClick: () => {
              setTries((count) => count + 1);
              goTo('shareholders');
            },
          }
        : { type: 'submit', form: preparationFormId })}
      label="Continue"
      primary
      busy={phase === 'shareholders' && busy}
      busyLabel="Saving draft…"
      disabled={busy || blocked || holderEditor}
    />
  );
  return (
    <Section title={REGISTER_IMPORT_COPY.SETUP_TITLE}>
      {(!visible || proposal?.status !== 'applied') && (
        <FormSteps
          label="Ledger setup steps"
          steps={REGISTER_SETUP_STEPS}
          current={phase}
          reachable={(step) => !classContentHeld && stepReachable(step as typeof phase)}
          onSelect={(step) => {
            const target = step as typeof phase;
            if (
              REGISTER_SETUP_STEPS.findIndex((step) => step.id === target) >
              REGISTER_SETUP_STEPS.findIndex((step) => step.id === phase)
            )
              setTries((count) => count + 1);
            goTo(target);
          }}
        />
      )}
      <div hidden={!visible || !mutable || phase !== 'details'}>{classDetails?.(recordFields)}</div>
      <div hidden={!visible || classHeld || classContentHeld}>
        <>
          {mutable ? (
            canPrepare ? (
              <form
                id={preparationFormId}
                hidden={phase === 'rights'}
                className="space-y-5"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  setTries((count) => count + 1);
                  if (phase === 'details') {
                    setAttempted(true);
                    if (!detailProblems.length && !blocked) {
                      setAttempted(false);
                      setPhase('rights');
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
                {(phase !== 'details' || !classDetails) && (
                  <fieldset
                    disabled={busy || uncertain || blocked}
                    className={
                      phase === 'details' ? 'grid min-w-0 items-start gap-6 md:grid-cols-2' : 'min-w-0 space-y-5'
                    }
                  >
                    {phase === 'details' && classFields}
                    {phase === 'details' && !classDetails && recordFields}
                    {phase === 'shareholders' && (
                      <BringRecords
                        draft={draft}
                        busy={busy}
                        differs={differs}
                        update={update}
                        setMember={setMember}
                        companyMembers={knownMembers}
                        preserveParticulars={preserveParticulars}
                        validateMember={holderProblems}
                        onEditorChange={setHolderEditor}
                        footer={(addAction) =>
                          !uncertain && (
                            <>
                              {emptyOpeningAllowed && !correction && draft.members.length === 0 && (
                                <p className="text-sm text-text-muted">
                                  If no shares have been issued, continue with no shareholders. Confirming records an
                                  empty opening; the first share issue is a separate company decision.
                                </p>
                              )}
                              <FormActions>
                                <PageAction
                                  label="Back"
                                  context="class rights"
                                  disabled={busy || blocked || holderEditor}
                                  onClick={() => {
                                    setAttempted(false);
                                    setPhase('rights');
                                  }}
                                />
                                {addAction}
                                {continueAction}
                              </FormActions>
                            </>
                          )
                        }
                      />
                    )}
                  </fieldset>
                )}
              </form>
            ) : (
              <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>
            )
          ) : (
            visible &&
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
                  <Row label="Class name" inline>
                    {shareClass?.name ?? register?.token.name ?? 'Not recorded'}
                  </Row>
                  <Row label="Class code" inline>
                    {shareClass?.symbol ?? register?.token.symbol ?? 'Not recorded'}
                  </Row>
                  {shareClass?.type && (
                    <Row label="Class type" inline>
                      {shareClass.type}
                    </Row>
                  )}
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
                {classReview}
                {proposal.correctionOf && <p className="text-sm text-text-muted">Correction: {proposal.reason}</p>}
                {hasSupportingRecords(proposal) && (
                  <ShowMore show="Show supporting records" hide="Hide supporting records">
                    <Rows>
                      {source && (
                        <Row label="Source record" inline>
                          {source}
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
                  <p className="text-xs text-text-muted">{REGISTER_IMPORT_COPY.EDIT_NOTE}</p>
                )}
                {editing && (
                  <p role="status" className="text-sm text-text-muted">
                    {REGISTER_IMPORT_COPY.REOPENING}
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
      </div>
      <div hidden={!visible || !mutable || phase !== 'rights' || classHeld}>{classContent}</div>
      {visible &&
        mutable &&
        canPrepare &&
        !classHeld &&
        !classContentHeld &&
        !uncertain &&
        !holderEditor &&
        (phase === 'details' || phase === 'rights') && (
          <FormActions>
            {phase === 'details' ? (
              <>
                {classActions}
                <PageAction
                  label="Cancel"
                  disabled={busy || blocked}
                  onClick={() => {
                    const place = registerPlace({ company, token: register?.token.uuid });
                    navigate(place.to, { state: place.state });
                  }}
                />
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
            ) : (
              <PageAction
                label="Back"
                context="share class"
                disabled={busy || blocked}
                onClick={() => goTo('details')}
              />
            )}
            {continueAction}
          </FormActions>
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

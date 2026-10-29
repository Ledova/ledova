import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { useLayoutEffect, useState } from 'react';
import { FIELD_LIMITS, formatDate, formatShareCount, type RegisterTransferMember } from '@ledova/shared';
import { Table } from '@components/List';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { MemberFields } from './MemberFields';
import { blankMember, type PreparationDraft, type MemberDraft } from './preparation';
import { ShowMore } from '@components/Ledger';

export function BringRecords({
  draft,
  today,
  correction,
  busy,
  differs,
  update,
  setMember,
  companyMembers,
  preserveParticulars,
  step,
  validateMember,
  onEditorChange,
}: {
  draft: PreparationDraft;
  today: string;
  correction: boolean;
  busy: boolean;
  differs: boolean;
  update: (apply: (current: PreparationDraft) => PreparationDraft) => void;
  setMember: (index: number, patch: Partial<MemberDraft>) => void;
  companyMembers: RegisterTransferMember[];
  preserveParticulars: boolean;
  step: 'details' | 'shareholders';
  validateMember: (index: number) => string[];
  onEditorChange: (open: boolean) => void;
}) {
  const [editor, setEditor] = useState<{ member: string; original: MemberDraft | null } | null>(null);
  const [memberCheck, setMemberCheck] = useState<{ attempt: number; problems: string[] }>({ attempt: 0, problems: [] });
  const editingIndex = draft.members.findIndex((row) => row.member === editor?.member);
  const editing = draft.members[editingIndex];
  const editorOpen = !!editing;
  const failing = editing ? validateMember(editingIndex) : [];
  const forget = () => setMemberCheck((current) => ({ ...current, problems: [] }));
  useLayoutEffect(() => {
    onEditorChange(editorOpen);
    return () => onEditorChange(false);
  }, [editorOpen, onEditorChange]);
  const started = (row: MemberDraft) =>
    !!(
      row.name ||
      row.residentialAddress ||
      row.enteredOn ||
      row.shares ||
      row.identityChoice ||
      row.documents.some((document) => document.file || document.evidence) ||
      row.allotments.some(
        (allotment) =>
          allotment.allottedOn ||
          allotment.shares ||
          allotment.amountPaid ||
          allotment.amountUnpaid ||
          allotment.shareReference ||
          allotment.certificateReference ||
          allotment.beneficiallyHeld !== null,
      )
    );
  const listed = draft.members.some((row) => started(row) && row.member !== editor?.member);
  const count = draft.members.filter(started).length;
  const add = () => {
    if (busy || editorOpen) return;
    const blank = draft.members.find((row) => !started(row));
    const row = blank ?? blankMember();
    if (!blank) update((current) => ({ ...current, members: [...current.members, row] }));
    forget();
    setEditor({ member: row.member, original: null });
  };
  return (
    <>
      {step === 'details' && (
        <fieldset className="space-y-3">
          <legend className="sr-only">Record date</legend>
          <Field label="Record date">
            <TextInput
              type="date"
              max={today}
              value={draft.asAt}
              onChange={(event) => update((current) => ({ ...current, asAt: event.target.value }))}
            />
          </Field>
          {correction && (
            <Field label={correction ? 'Reason for correcting the mirror' : 'Reason'}>
              <TextArea
                rows={2}
                value={draft.reason}
                maxLength={FIELD_LIMITS.REASON}
                onChange={(event) => update((current) => ({ ...current, reason: event.target.value }))}
              />
            </Field>
          )}
          {correction && (
            <p className="text-sm text-text-muted">
              This corrects a copied opening. The earlier snapshot and evidence remain in history. It does not change
              the company’s legal records.
            </p>
          )}
        </fieldset>
      )}
      {step === 'shareholders' && (
        <>
          <fieldset className="min-w-0 space-y-3">
            <legend className="sr-only">Shareholders</legend>
            {!editorOpen && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-text-muted">
                  {count === 0
                    ? 'No shareholders added yet.'
                    : `${count} ${count === 1 ? 'shareholder' : 'shareholders'} in this draft`}
                </p>
                <PageAction label="Add a shareholder" disabled={busy} onClick={add} />
              </div>
            )}
            {listed && (
              <Table
                caption="Draft shareholders"
                columns={[
                  { label: 'Shareholder' },
                  { label: 'Shares held', align: 'right' },
                  { label: 'Date added' },
                  { label: 'Actions', hidden: true },
                ]}
              >
                {draft.members.map((row, index) =>
                  started(row) && row.member !== editor?.member ? (
                    <tr key={row.member}>
                      <th scope="row" className="px-4 py-4 text-left font-normal">
                        <p className="font-medium text-text-primary">{row.name || 'Shareholder details incomplete'}</p>
                        <p className="mt-1 max-w-64 truncate text-xs text-text-muted">{row.residentialAddress}</p>
                        {validateMember(index).length > 0 && (
                          <p className="mt-1 text-xs text-error-light">Needs details</p>
                        )}
                      </th>
                      <td className="px-4 py-4 text-right tabular-nums">
                        {row.shares ? formatShareCount(row.shares) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-text-muted">{formatDate(row.enteredOn, '—')}</td>
                      <td className="px-4 py-4">
                        <div className="flex gap-2">
                          <PageAction
                            label="Edit"
                            context={`shareholder ${index + 1}`}
                            disabled={busy || editorOpen}
                            onClick={() => {
                              forget();
                              setEditor({ member: row.member, original: row });
                            }}
                          />
                          <PageAction
                            label="Remove"
                            context={`shareholder ${index + 1}`}
                            disabled={busy || editorOpen}
                            onClick={() =>
                              update((current) => ({
                                ...current,
                                members: current.members.filter((_, at) => at !== index),
                              }))
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null,
                )}
              </Table>
            )}
            {editing && (
              <div className={listed ? 'space-y-5 border-t border-border-subtle pt-5' : 'space-y-5'}>
                <h3 className="text-base font-medium text-text-primary">
                  {editor?.original ? 'Edit shareholder' : 'Add shareholder'}
                </h3>
                <ErrorSummary
                  attempt={memberCheck.attempt}
                  problems={memberCheck.problems
                    .filter((problem) => failing.includes(problem))
                    .map((message) => ({ message }))}
                />
                <MemberFields
                  key={editing.member}
                  row={editing}
                  index={editingIndex}
                  asAt={draft.asAt}
                  companyMembers={companyMembers}
                  preserveParticulars={preserveParticulars}
                  usedMembers={draft.members.filter((_, at) => at !== editingIndex).map((member) => member.member)}
                  validationAttempt={memberCheck.attempt}
                  update={(patch) => {
                    setMember(editingIndex, patch);
                    if (patch.member) setEditor((current) => (current ? { ...current, member: patch.member! } : null));
                  }}
                />
                <FormActions>
                  <PageAction
                    label="Cancel"
                    context="shareholder edit"
                    disabled={busy}
                    onClick={() => {
                      const original = editor?.original;
                      update((current) => ({
                        ...current,
                        members: original
                          ? current.members.map((row, index) => (index === editingIndex ? original : row))
                          : current.members.filter((_, index) => index !== editingIndex),
                      }));
                      setEditor(null);
                      forget();
                    }}
                  />
                  <PageAction
                    label={editor?.original ? 'Save changes' : 'Add shareholder'}
                    primary
                    disabled={busy}
                    onClick={() => {
                      setMemberCheck((current) => ({ attempt: current.attempt + 1, problems: failing }));
                      if (!failing.length) setEditor(null);
                    }}
                  />
                </FormActions>
              </div>
            )}
          </fieldset>
          <ShowMore show="Show company source copies" hide="Hide company source copies">
            {draft.earlierCopiesNotReused && (
              <p className="text-sm text-text-muted">
                Earlier source documents remain with their original record. Add replacement documents if needed.
              </p>
            )}
            <FileField
              label="Current share register"
              hint={draft.registerEvidence && 'The retained source copy will be reused unless you choose another file.'}
              onFile={(file) => update((current) => ({ ...current, registerFile: file }))}
            />
            <FileField
              label="ASIC extract"
              hint={draft.asicEvidence && 'The retained ASIC copy and figures will be reused unless you change them.'}
              onFile={(file) => update((current) => ({ ...current, asicFile: file }))}
            />
            {(draft.statedTotal || draft.statedCount) && (
              <fieldset className="space-y-3 border-t border-border-subtle pt-3">
                <legend className="sr-only">Earlier ASIC comparison</legend>
                <p className="text-sm text-text-muted">
                  Earlier ASIC comparison
                  {draft.statedTotal && ` · ${formatShareCount(draft.statedTotal)} issued shares`}
                  {draft.statedCount &&
                    ` · ${formatShareCount(draft.statedCount)} ${draft.statedCount === '1' ? 'shareholder' : 'shareholders'} listed`}
                </p>
                {!draft.asicEvidence && !draft.asicFile && (
                  <p className="text-sm text-text-muted">
                    Add a replacement ASIC extract above or leave out these earlier comparison figures.
                  </p>
                )}
                {differs && (
                  <p role="alert" className="text-sm text-error-light">
                    The earlier comparison differs from the current shareholders. Check the source or leave out the
                    comparison before continuing.
                  </p>
                )}
                <PageAction
                  label="Leave out ASIC comparison"
                  disabled={busy}
                  onClick={() => update((current) => ({ ...current, statedTotal: '', statedCount: '' }))}
                />
              </fieldset>
            )}
          </ShowMore>
        </>
      )}
    </>
  );
}

import { Field, TextArea, TextInput } from '@components/Field';
import { useLayoutEffect, useState } from 'react';
import {
  FIELD_LIMITS,
  REGISTER_IMPORT_COPY,
  formatDate,
  formatShareCount,
  type RegisterTransferMember,
  type RegisterAwardRecipient,
} from '@ledova/shared';
import { Table } from '@components/List';
import { FormActions, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { MemberFields } from './MemberFields';
import { blankMember, blankFormer, type PreparationDraft, type MemberDraft, type FormerDraft } from './preparation';

const EVIDENCE = 'application/pdf,image/png,image/jpeg';

export function BringRecords({
  draft,
  today,
  correction,
  busy,
  differs,
  imported,
  update,
  setMember,
  setFormer,
  companyMembers,
  awardRecipients,
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
  imported: { total: string; count: number };
  update: (apply: (current: PreparationDraft) => PreparationDraft) => void;
  setMember: (index: number, patch: Partial<MemberDraft>) => void;
  setFormer: (index: number, patch: Partial<FormerDraft>) => void;
  companyMembers: RegisterTransferMember[];
  awardRecipients: RegisterAwardRecipient[];
  preserveParticulars: boolean;
  step: 'details' | 'shareholders';
  validateMember: (index: number) => string[];
  onEditorChange: (open: boolean) => void;
}) {
  const [editor, setEditor] = useState<{ member: string; original: MemberDraft | null } | null>(null);
  const [memberErrors, setMemberErrors] = useState<string[]>([]);
  const editingIndex = draft.members.findIndex((row) => row.member === editor?.member);
  const editing = draft.members[editingIndex];
  const editorOpen = !!editing;
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
  const add = () => {
    if (busy || editorOpen) return;
    const blank = draft.members.find((row) => !started(row));
    const row = blank ?? blankMember();
    if (!blank) update((current) => ({ ...current, members: [...current.members, row] }));
    setMemberErrors([]);
    setEditor({ member: row.member, original: null });
  };
  return (
    <>
      {step === 'shareholders' && draft.earlierCopiesNotReused && (
        <p className="text-sm text-text-muted">
          The earlier source copies stay with the earlier snapshot. This draft does not reuse them; choose optional
          replacements below. To keep copied ASIC comparison figures, add an ASIC extract or leave out the comparison.
        </p>
      )}
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
          <fieldset className="space-y-3">
            <legend className="sr-only">Shareholders</legend>
            {!editorOpen && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-text-muted">
                  {draft.members.filter(started).length}{' '}
                  {draft.members.filter(started).length === 1 ? 'shareholder' : 'shareholders'} in this draft
                </p>
                <PageAction label="Add a shareholder" primary disabled={busy} onClick={add} />
              </div>
            )}
            {!draft.members.some(started) && !editorOpen && (
              <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center">
                <p className="text-sm text-text-muted">No shareholders added yet.</p>
              </div>
            )}
            {draft.members.some((row) => started(row) && row.member !== editor?.member) && (
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
                              setMemberErrors([]);
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
              <div className="space-y-5 rounded-xl bg-surface-tertiary p-4 sm:p-5">
                <h3 className="text-base font-medium text-text-primary">
                  {editor?.original ? 'Edit shareholder' : 'Add shareholder'}
                </h3>
                <MemberFields
                  key={editing.member}
                  row={editing}
                  index={editingIndex}
                  asAt={draft.asAt}
                  companyMembers={companyMembers}
                  awardRecipients={awardRecipients}
                  preserveParticulars={preserveParticulars}
                  usedMembers={draft.members.filter((_, at) => at !== editingIndex).map((member) => member.member)}
                  update={(patch) => {
                    setMember(editingIndex, patch);
                    if (patch.member) setEditor((current) => (current ? { ...current, member: patch.member! } : null));
                  }}
                />
                {memberErrors.length > 0 && (
                  <ul role="alert" className="space-y-1 text-sm text-error-light">
                    {memberErrors.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
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
                      setMemberErrors([]);
                    }}
                  />
                  <PageAction
                    label={editor?.original ? 'Done editing' : 'Add to draft'}
                    primary
                    disabled={busy}
                    onClick={() => {
                      const errors = validateMember(editingIndex);
                      setMemberErrors(errors);
                      if (!errors.length) setEditor(null);
                    }}
                  />
                </FormActions>
              </div>
            )}
          </fieldset>
          <details className="space-y-4 rounded-lg border border-border-subtle p-4">
            <summary className="cursor-pointer text-sm font-medium text-text-primary">
              Keep source copies and former records (optional)
            </summary>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-text-primary">Supporting copies (optional)</legend>
              <label className={LABEL}>
                Current share register (optional)
                {draft.registerEvidence && (
                  <span className="block text-xs text-text-muted">
                    The retained source copy will be reused unless you choose another file.
                  </span>
                )}
                <input
                  type="file"
                  accept={EVIDENCE}
                  className={FIELD_CLASS}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    update((current) => ({ ...current, registerFile: file }));
                  }}
                />
              </label>
              <label className={LABEL}>
                ASIC extract (optional)
                {draft.asicEvidence && (
                  <span className="block text-xs text-text-muted">
                    The retained ASIC copy and figures will be reused unless you change them.
                  </span>
                )}
                <input
                  type="file"
                  accept={EVIDENCE}
                  className={FIELD_CLASS}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    update((current) => ({ ...current, asicFile: file }));
                  }}
                />
              </label>
              <p className="text-sm text-text-muted">
                PDF or image, max 10 MB. Ledova does not verify either document.
              </p>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-text-primary">Former members</legend>
              <p className="text-sm text-text-muted">
                Copy former shareholders only if useful. The company continues to retain its legal historical records
                elsewhere.
              </p>
              {draft.former.map((row, index) => (
                <fieldset key={row.id} className="space-y-2 border-t border-border-subtle pt-3">
                  <legend className="text-sm text-text-primary">Former member {index + 1}</legend>
                  <Field label="Name">
                    <TextInput
                      value={row.name}
                      maxLength={FIELD_LIMITS.NAME}
                      onChange={(event) => setFormer(index, { name: event.target.value })}
                    />
                  </Field>
                  <Field label="Residential address">
                    <TextInput
                      value={row.residentialAddress}
                      maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
                      onChange={(event) => setFormer(index, { residentialAddress: event.target.value })}
                    />
                  </Field>
                  <Field label="Shares">
                    <TextInput
                      maxLength={FIELD_LIMITS.REGISTER_SHARES}
                      inputMode="numeric"
                      value={row.shares}
                      onChange={(event) => setFormer(index, { shares: event.target.value })}
                    />
                  </Field>
                  <Field label="Date ceased">
                    <TextInput
                      type="date"
                      max={draft.asAt}
                      value={row.ceasedOn}
                      onChange={(event) => setFormer(index, { ceasedOn: event.target.value })}
                    />
                  </Field>
                  <PageAction
                    label={`Remove former member ${index + 1}`}
                    disabled={busy}
                    onClick={() =>
                      update((current) => ({ ...current, former: current.former.filter((_, at) => at !== index) }))
                    }
                  />
                </fieldset>
              ))}
              <PageAction
                label="Add a former member"
                disabled={busy}
                onClick={() => update((current) => ({ ...current, former: [...current.former, blankFormer()] }))}
              />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-text-primary">Comparison figures (optional)</legend>
              <p className="text-sm text-text-muted">
                An ASIC extract may list only some shareholders. Its listed count is a cross-check, not the source for
                the full ownership record.
              </p>
              <Field label="Issued shares in the comparison source (optional)">
                <TextInput
                  maxLength={FIELD_LIMITS.REGISTER_SHARES}
                  inputMode="numeric"
                  value={draft.statedTotal}
                  onChange={(event) => {
                    const statedTotal = event.target.value;
                    update((current) => ({ ...current, statedTotal }));
                  }}
                />
              </Field>
              <Field label="Shareholders listed in the comparison source (optional)">
                <TextInput
                  inputMode="numeric"
                  value={draft.statedCount}
                  onChange={(event) => {
                    const statedCount = event.target.value;
                    update((current) => ({ ...current, statedCount }));
                  }}
                />
              </Field>
              {(draft.statedTotal || draft.statedCount) && (
                <PageAction
                  label="Leave out ASIC comparison"
                  disabled={busy}
                  onClick={() => update((current) => ({ ...current, statedTotal: '', statedCount: '' }))}
                />
              )}
              <p className="text-sm text-text-primary">
                {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(imported.total), imported.count)}
              </p>
              {differs && (
                <p role="alert" className="text-sm text-error-light">
                  The comparison figures differ from the copied rows. Check both against the source before continuing.
                </p>
              )}
            </fieldset>
          </details>
        </>
      )}
    </>
  );
}

import { useLayoutEffect, useMemo, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  REGISTER_MEMBER_DOCUMENT_CATEGORIES,
  UPLOAD_RULE,
  allotmentProblems,
  blankAllotment,
  blankMember,
  formatDate,
  formatShareCount,
  memberAddedOn,
  peopleFrom,
  registerImportMoney,
  shareCount,
  wholeShares,
  type AllotmentDraft,
  type DocumentDraft,
  type MemberDraft,
  type PreparationDraft,
  type RegisterMemberDocumentCategory,
  type RegisterTransferMember,
} from '@ledova/shared';
import { Action, Actions, FormActions, Rows, ShowMore } from '../../components/Ledger';
import { PersonSelect } from '../../components/PersonSelect';
import { Field, FileField } from '../../components/register/RegisterFields';
import { SelectField } from '../../components/SelectField';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { DATE } from './IssueForms';
import { MemberRow } from './ImportRecord';
import { useLedgerStyles } from './useLedgerStyles';

const CATEGORIES = Object.entries(REGISTER_MEMBER_DOCUMENT_CATEGORIES).map(([value, label]) => ({
  value: value as RegisterMemberDocumentCategory,
  label,
}));
const NO_DOCUMENTS: DocumentDraft[] = [];

type Update = (change: (current: PreparationDraft) => PreparationDraft) => void;

export function Problems({ problems }: { problems: string[] }) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  if (!problems.length) return null;
  return (
    <View accessibilityRole="alert" style={look.terms}>
      {problems.map((problem) => (
        <Text key={problem} style={styles.error}>
          {problem}
        </Text>
      ))}
    </View>
  );
}

function started(row: MemberDraft) {
  return !!(
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
}

export function ImportShareholders({
  draft,
  locked,
  differs,
  update,
  setMember,
  companyMembers,
  preserveParticulars,
  validateMember,
  onEditorChange,
}: {
  draft: PreparationDraft;
  locked: boolean;
  differs: boolean;
  update: Update;
  setMember: (index: number, patch: Partial<MemberDraft>) => void;
  companyMembers: RegisterTransferMember[];
  preserveParticulars: boolean;
  validateMember: (index: number) => string[];
  onEditorChange: (open: boolean) => void;
}) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const [editor, setEditor] = useState<{ member: string; original: MemberDraft | null } | null>(null);
  const [memberCheck, setMemberCheck] = useState<{ attempt: number; problems: string[] }>({ attempt: 0, problems: [] });
  const [session, setSession] = useState(0);
  const [keys] = useState(() => new Map<string, string>());
  const keyOf = (member: string) => {
    const key = keys.get(member) ?? randomUUID();
    keys.set(member, key);
    return key;
  };
  const rekey = (from: string, to: string) => {
    if (from === to) return;
    const key = keyOf(from);
    keys.delete(from);
    keys.set(to, key);
  };
  const editingIndex = draft.members.findIndex((row) => row.member === editor?.member);
  const editing = draft.members[editingIndex];
  const editorOpen = !!editing;
  const failing = editing ? validateMember(editingIndex) : [];
  const forget = () => setMemberCheck((current) => ({ ...current, problems: [] }));
  useLayoutEffect(() => {
    onEditorChange(editorOpen);
    return () => onEditorChange(false);
  }, [editorOpen, onEditorChange]);
  const listed = draft.members.some((row) => started(row) && row.member !== editor?.member);
  const count = draft.members.filter(started).length;
  const edit = (member: string, original: MemberDraft | null) => {
    forget();
    setSession((current) => current + 1);
    setEditor({ member, original });
  };
  const add = () => {
    if (locked || editorOpen) return;
    const blank = draft.members.find((row) => !started(row));
    const row = blank ?? blankMember(randomUUID);
    if (!blank) update((current) => ({ ...current, members: [...current.members, row] }));
    edit(row.member, null);
  };
  return (
    <>
      <View style={look.fields}>
        {!editorOpen && (
          <View style={look.line}>
            <Text style={[look.muted, look.fill]}>
              {count === 0
                ? 'No shareholders added yet.'
                : `${count} ${count === 1 ? 'shareholder' : 'shareholders'} in this draft`}
            </Text>
            <Action label="Add a shareholder" disabled={locked} onPress={add} />
          </View>
        )}
        {listed && (
          <View accessibilityLabel="Draft shareholders">
            <Rows>
              {draft.members.map((row, index) =>
                started(row) && row.member !== editor?.member ? (
                  <View key={row.member} style={look.row}>
                    <MemberRow
                      name={row.name || 'Shareholder details incomplete'}
                      shares={row.shares ? shareCount(row.shares) : '—'}
                      address={row.residentialAddress}
                      facts={
                        <>
                          {memberAddedOn(row.enteredOn)}
                          {validateMember(index).length > 0 && <Text style={look.smallError}> · Needs details</Text>}
                        </>
                      }
                    >
                      <Action
                        compact
                        label="Edit"
                        accessibilityLabel={`Edit (shareholder ${index + 1})`}
                        disabled={locked || editorOpen}
                        onPress={() => edit(row.member, row)}
                      />
                      <Action
                        compact
                        label="Remove"
                        accessibilityLabel={`Remove (shareholder ${index + 1})`}
                        disabled={locked || editorOpen}
                        onPress={() =>
                          update((current) => ({
                            ...current,
                            members: current.members.filter((_, at) => at !== index),
                          }))
                        }
                      />
                    </MemberRow>
                  </View>
                ) : null,
              )}
            </Rows>
          </View>
        )}
        {editing && (
          <View style={[look.fields, listed && look.ruled]}>
            <Text accessibilityRole="header" style={look.heading}>
              {editor?.original ? 'Edit shareholder' : 'Add shareholder'}
            </Text>
            <Problems problems={memberCheck.problems.filter((problem) => failing.includes(problem))} />
          </View>
        )}
        {draft.members.map((row, index) => {
          const shown = row.member === editor?.member;
          if (!shown && !row.documents.some((document) => document.file)) return null;
          return (
            <View key={keyOf(row.member)} style={!shown && look.hidden}>
              <MemberFields
                row={row}
                index={index}
                session={session}
                companyMembers={companyMembers}
                preserveParticulars={preserveParticulars}
                usedMembers={draft.members.filter((other) => other.member !== row.member).map(({ member }) => member)}
                validationAttempt={memberCheck.attempt}
                kept={shown ? (editor?.original?.documents ?? NO_DOCUMENTS) : NO_DOCUMENTS}
                asAt={draft.asAt}
                locked={locked}
                update={(patch) => {
                  setMember(index, patch);
                  if (shown && patch.member) {
                    rekey(row.member, patch.member);
                    setEditor((current) => (current ? { ...current, member: patch.member! } : null));
                  }
                }}
              />
            </View>
          );
        })}
        {editing && (
          <FormActions>
            <Action
              label="Cancel"
              accessibilityLabel="Cancel (shareholder edit)"
              disabled={locked}
              onPress={() => {
                Keyboard.dismiss();
                const original = editor?.original;
                if (original && editing) rekey(editing.member, original.member);
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
            <Action
              primary
              label={editor?.original ? 'Save changes' : 'Add shareholder'}
              disabled={locked}
              onPress={() => {
                Keyboard.dismiss();
                setMemberCheck((current) => ({ attempt: current.attempt + 1, problems: failing }));
                if (!failing.length) setEditor(null);
              }}
            />
          </FormActions>
        )}
      </View>
      <ShowMore show="Show company source copies" hide="Hide company source copies">
        {draft.earlierCopiesNotReused && (
          <Text style={look.muted}>
            Earlier source documents remain with their original record. Add replacement documents if needed.
          </Text>
        )}
        <FileField
          label="Current share register"
          value={draft.registerFile}
          hint={
            draft.registerEvidence
              ? `${UPLOAD_RULE.HINT} The retained source copy will be reused unless you choose another file.`
              : UPLOAD_RULE.HINT
          }
          disabled={locked}
          onFile={(file) => update((current) => ({ ...current, registerFile: file }))}
        />
        <FileField
          label="ASIC extract"
          value={draft.asicFile}
          hint={
            draft.asicEvidence
              ? `${UPLOAD_RULE.HINT} The retained ASIC copy and figures will be reused unless you change them.`
              : UPLOAD_RULE.HINT
          }
          disabled={locked}
          onFile={(file) => update((current) => ({ ...current, asicFile: file }))}
        />
        {!!(draft.statedTotal || draft.statedCount) && (
          <View style={[look.fields, look.ruled]}>
            <Text style={look.muted}>
              Earlier ASIC comparison
              {!!draft.statedTotal && ` · ${formatShareCount(draft.statedTotal)} issued shares`}
              {!!draft.statedCount &&
                ` · ${formatShareCount(draft.statedCount)} ${draft.statedCount === '1' ? 'shareholder' : 'shareholders'} listed`}
            </Text>
            {!draft.asicEvidence && !draft.asicFile && (
              <Text style={look.muted}>
                Add a replacement ASIC extract above or leave out these earlier comparison figures.
              </Text>
            )}
            {differs && (
              <Text accessibilityRole="alert" style={styles.error}>
                The earlier comparison differs from the current shareholders. Check the source or leave out the
                comparison before continuing.
              </Text>
            )}
            <Actions>
              <Action
                label="Leave out ASIC comparison"
                disabled={locked}
                onPress={() => update((current) => ({ ...current, statedTotal: '', statedCount: '' }))}
              />
            </Actions>
          </View>
        )}
      </ShowMore>
    </>
  );
}

function MemberFields({
  row,
  index,
  session,
  companyMembers,
  preserveParticulars,
  usedMembers,
  validationAttempt,
  kept,
  asAt,
  locked,
  update,
}: {
  row: MemberDraft;
  index: number;
  session: number;
  companyMembers: RegisterTransferMember[];
  preserveParticulars: boolean;
  usedMembers: string[];
  validationAttempt: number;
  kept: DocumentDraft[];
  asAt: string;
  locked: boolean;
  update: (patch: Partial<MemberDraft>) => void;
}) {
  const look = useLedgerStyles();
  return (
    <View style={look.fields}>
      <PersonFields
        key={`person/${session}`}
        row={row}
        companyMembers={companyMembers}
        preserveParticulars={preserveParticulars}
        usedMembers={usedMembers}
        locked={locked}
        update={update}
      />
      <AllotmentFields
        key={`allotments/${session}`}
        allotments={row.allotments}
        asAt={asAt}
        shareholder={index + 1}
        validationAttempt={validationAttempt}
        locked={locked}
        update={(allotments) => update({ allotments })}
      />
      <DocumentAttachments
        documents={row.documents}
        kept={kept}
        locked={locked}
        update={(documents) => update({ documents })}
      />
    </View>
  );
}

function PersonFields({
  row,
  companyMembers,
  preserveParticulars,
  usedMembers,
  locked,
  update,
}: {
  row: MemberDraft;
  companyMembers: RegisterTransferMember[];
  preserveParticulars: boolean;
  usedMembers: string[];
  locked: boolean;
  update: (patch: Partial<MemberDraft>) => void;
}) {
  const [personError, setPersonError] = useState('');
  const people = useMemo(() => peopleFrom({ members: companyMembers, awardRecipients: [] }), [companyMembers]);
  const retained = companyMembers.find((member) => member.member === row.member);
  const recipient = retained?.onRegister === false ? retained : undefined;
  const known = recipient ? undefined : retained;
  const current = retained?.member ?? (row.identityChoice === 'new' ? 'new' : '');
  return (
    <>
      {people.length > 0 && (
        <PersonSelect
          label="Company shareholder"
          people={people}
          value={current}
          allowNew
          disabledMembers={usedMembers}
          disabled={locked}
          error={personError}
          onChange={(value) => {
            if (value !== current && row.documents.some((document) => document.file || document.evidence)) {
              setPersonError('Remove the attached documents before choosing another shareholder.');
              return;
            }
            setPersonError('');
            if (value === 'new')
              update({
                member: retained ? randomUUID() : row.member,
                identityChoice: 'new',
                ...(retained ? { name: '', residentialAddress: '' } : {}),
              });
            else {
              const chosen = people.find((person) => person.member === value);
              if (chosen && !usedMembers.includes(chosen.member))
                update({
                  member: chosen.member,
                  identityChoice: chosen.onRegister === false ? 'award' : 'existing',
                  name: chosen.name,
                  residentialAddress: chosen.residentialAddress,
                });
            }
          }}
        />
      )}
      <Field
        label="Name"
        value={row.name}
        maxLength={FIELD_LIMITS.NAME}
        editable={!locked && !recipient && !(preserveParticulars && !!known?.name)}
        onChange={(name) => update({ name })}
      />
      <Field
        label="Residential address"
        value={row.residentialAddress}
        maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
        multiline
        editable={!locked && !recipient && !(preserveParticulars && !!known?.residentialAddress)}
        onChange={(residentialAddress) => update({ residentialAddress })}
      />
      <Field
        label="Date first added to register"
        value={row.enteredOn}
        {...DATE}
        editable={!locked}
        onChange={(enteredOn) => update({ enteredOn: enteredOn.trim() })}
      />
      <Field
        label="Current shares held"
        value={row.shares}
        keyboardType="number-pad"
        maxLength={FIELD_LIMITS.REGISTER_SHARES}
        editable={!locked}
        onChange={(shares) => update({ shares })}
      />
    </>
  );
}

function AllotmentFields({
  allotments,
  asAt,
  shareholder,
  validationAttempt,
  locked,
  update,
}: {
  allotments: AllotmentDraft[];
  asAt: string;
  shareholder: number;
  validationAttempt: number;
  locked: boolean;
  update: (allotments: AllotmentDraft[]) => void;
}) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const [editor, setEditor] = useState({
    selected: allotments[0]?.id,
    validationAttempt,
    check: { id: '', attempt: 0 },
  });
  const { selected, check } = editor;
  const active = allotments.some((row) => row.id === selected) ? selected : allotments[0]?.id;
  const money = (value: string) => {
    const amount = registerImportMoney(value.trim() || '0');
    return amount === null ? '—' : formatShareCount(amount);
  };
  if (editor.validationAttempt !== validationAttempt) {
    const invalid = allotments.find((row) => allotmentProblems(row, asAt).length > 0);
    setEditor({
      selected: invalid?.id ?? selected,
      validationAttempt,
      check: { id: invalid?.id ?? '', attempt: 0 },
    });
  }
  const edit = (id: string) => setEditor((current) => ({ ...current, selected: id, check: { id: '', attempt: 0 } }));
  const remove = (id: string) => {
    const remaining = allotments.filter((row) => row.id !== id);
    if (active === id && remaining[0]) edit(remaining[0].id);
    update(remaining);
  };
  const add = () => {
    const current = allotments.find((row) => row.id === active);
    if (current && allotmentProblems(current, asAt).length > 0) {
      setEditor((prior) => ({ ...prior, check: { id: current.id, attempt: prior.check.attempt + 1 } }));
      return;
    }
    const unfinished = allotments.find((row) => allotmentProblems(row, asAt).length > 0);
    if (unfinished) edit(unfinished.id);
    else {
      const next = blankAllotment(randomUUID);
      update([...allotments, next]);
      edit(next.id);
    }
  };
  return (
    <View accessibilityLabel="Allocation history" style={look.group}>
      <View style={look.line}>
        <Text accessibilityRole="header" style={look.title}>
          Allocation history
        </Text>
        <Action
          label="Add allocation"
          accessibilityLabel={`Add allocation (shareholder ${shareholder})`}
          disabled={locked}
          onPress={add}
        />
      </View>
      {allotments.map((allotment, at) => {
        const shown = active === allotment.id;
        const problems = allotmentProblems(allotment, asAt);
        const shares = wholeShares(allotment.shares.trim());
        const set = (patch: Partial<AllotmentDraft>) =>
          update(allotments.map((row) => (row.id === allotment.id ? { ...row, ...patch } : row)));
        return (
          <View key={allotment.id} style={[look.summary, at > 0 && look.ruled]}>
            {!shown && (
              <View style={look.line}>
                <View style={[look.fill, look.terms]}>
                  <Text style={look.title}>
                    {formatDate(allotment.allottedOn, 'Date not entered')} ·{' '}
                    {shares === null
                      ? 'Shares not entered'
                      : `${formatShareCount(allotment.shares.trim())} ${shares === 1n ? 'share' : 'shares'}`}
                  </Text>
                  <Text style={look.small}>
                    Paid {money(allotment.amountPaid)} · Unpaid {money(allotment.amountUnpaid)}
                  </Text>
                  {problems.length > 0 && <Text style={styles.error}>Needs details</Text>}
                </View>
                <View style={look.wrap}>
                  <Action
                    label="Edit"
                    accessibilityLabel={`Edit (allocation ${at + 1})`}
                    disabled={locked}
                    onPress={() => edit(allotment.id)}
                  />
                  <Action
                    label="Remove"
                    accessibilityLabel={`Remove (allocation ${at + 1})`}
                    disabled={locked}
                    onPress={() => remove(allotment.id)}
                  />
                </View>
              </View>
            )}
            <View style={[look.fields, !shown && look.hidden]}>
              <Problems problems={check.id === allotment.id && check.attempt > 0 ? problems : []} />
              <Field
                label="Date"
                accessibilityLabel="Allocation date"
                value={allotment.allottedOn}
                {...DATE}
                editable={!locked}
                onChange={(allottedOn) => set({ allottedOn: allottedOn.trim() })}
              />
              <Field
                label="Shares"
                accessibilityLabel="Allocation shares"
                value={allotment.shares}
                keyboardType="number-pad"
                maxLength={FIELD_LIMITS.REGISTER_SHARES}
                editable={!locked}
                onChange={(value) => set({ shares: value })}
              />
              <Field
                label="Amount paid"
                value={allotment.amountPaid}
                keyboardType="decimal-pad"
                placeholder="0.00"
                maxLength={FIELD_LIMITS.AMOUNT}
                editable={!locked}
                onChange={(amountPaid) => set({ amountPaid })}
              />
              <Field
                label="Amount unpaid"
                value={allotment.amountUnpaid}
                keyboardType="decimal-pad"
                placeholder="0.00"
                maxLength={FIELD_LIMITS.AMOUNT}
                editable={!locked}
                onChange={(amountUnpaid) =>
                  set({ amountUnpaid, fullyPaid: registerImportMoney(amountUnpaid.trim() || '0') === '0.00' })
                }
              />
              <Actions>
                <Action
                  label="Remove"
                  accessibilityLabel={`Remove (allocation ${at + 1})`}
                  disabled={locked}
                  onPress={() => remove(allotment.id)}
                />
              </Actions>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function DocumentAttachments({
  documents,
  kept,
  locked,
  update,
}: {
  documents: DocumentDraft[];
  kept: DocumentDraft[];
  locked: boolean;
  update: (documents: DocumentDraft[]) => void;
}) {
  const look = useLedgerStyles();
  const current = new Set(documents.map(({ id }) => id));
  const rows = [...documents, ...kept.filter(({ id }) => !current.has(id))];
  return (
    <View accessibilityLabel="Documents" style={look.group}>
      <View style={look.line}>
        <Text accessibilityRole="header" style={look.title}>
          Documents
        </Text>
        <Action
          label="Add document"
          disabled={locked}
          onPress={() => update([...documents, { id: randomUUID(), category: 'other', file: null }])}
        />
      </View>
      {rows.map((document) => {
        const position = documents.findIndex(({ id }) => id === document.id);
        return (
          <View key={document.id} style={[look.summary, position > 0 && look.ruled, position < 0 && look.hidden]}>
            <SelectField
              label="Category"
              options={CATEGORIES}
              value={document.category}
              disabled={locked || !!document.evidence}
              onChange={(category) =>
                update(documents.map((row) => (row.id === document.id ? { ...row, category } : row)))
              }
            />
            {document.evidence ? (
              <Text style={look.text}>{document.snapshot?.name || 'Retained supporting document'}</Text>
            ) : (
              <FileField
                label="File"
                value={document.file}
                hint={UPLOAD_RULE.HINT}
                disabled={locked || !!document.file}
                onFile={(file) => update(documents.map((row) => (row.id === document.id ? { ...row, file } : row)))}
              />
            )}
            <Actions>
              <Action
                label="Remove"
                accessibilityLabel={`Remove (document ${position + 1})`}
                disabled={locked}
                onPress={() => update(documents.filter((row) => row.id !== document.id))}
              />
            </Actions>
          </View>
        );
      })}
    </View>
  );
}

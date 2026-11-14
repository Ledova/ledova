import { useState, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  REGISTER_IMPORT_COPY as COPY,
  REGISTER_IMPORT_DECISIONS,
  REGISTER_SETUP_STEPS,
  formatDate,
  formatShareCount,
  formatShortDate,
  refusalSentences,
  registerImportTotals,
  shareCount,
  useImportPreparation,
  type ImportPreparationOptions,
} from '@ledova/shared';
import { Action, Fact, FormActions, Rows, Section, ShowMore, Status } from '../../components/Ledger';
import { Field } from '../../components/Field';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ImportShareholders, Problems } from './ImportShareholders';
import { MemberRecords, MemberRow } from './ImportRecord';
import { DATE, FormSteps } from './IssueForms';
import { useLedgerStyles } from './useLedgerStyles';

type ImportFormProps = Omit<ImportPreparationOptions, 'newKey' | 'session'> & {
  shareClass?: { name: string; symbol: string };
  classFields?: ReactNode;
  onCancel: () => void;
};

const SOURCE = 'Company-provided share records';

export function ImportForm({ shareClass, classFields, onCancel, ...options }: ImportFormProps) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const { register, steps, blocked, correction, emptyOpeningAllowed = false, visible = true } = options;
  const model = useImportPreparation({ ...options, newKey: randomUUID, session: orderSubmissionSession });
  const [running, setRunning] = useState<string | null>(null);
  const track = (key: string, work: Promise<unknown>) => {
    setRunning(key);
    void work.finally(() => setRunning(null));
  };
  const { draft, proposal, phase, mutable, canPrepare, busy, uncertain, recovery, deciding, autoApply, kind } = model;
  const locked = busy || uncertain || blocked;
  const editable = visible && mutable && canPrepare;
  const reviewing = visible && !mutable && proposal?.status === 'submitted';
  const recorded = visible && !mutable && proposal?.status === 'applied';
  const title =
    [shareClass?.name ?? register?.token.name, shareClass?.symbol ?? register?.token.symbol]
      .filter(Boolean)
      .join(' · ') || 'New share class';
  const submit = () => {
    Keyboard.dismiss();
    if (phase === 'details') {
      model.setAttempted(true);
      if (!model.detailProblems.length && !blocked) {
        model.setAttempted(false);
        model.setPhase('shareholders');
      }
    } else if (!model.holderEditor) void model.prepare();
  };
  const supporting =
    !!proposal &&
    ((proposal.sourceReference || proposal.authorityReference) !== SOURCE ||
      proposal.asicIssuedTotal !== null ||
      proposal.asicMemberCount !== null ||
      !!proposal.registerEvidence ||
      !!proposal.asicEvidence);
  const total = proposal ? formatShareCount(registerImportTotals(proposal.members).total) : '';
  return (
    <Section title={title}>
      {(!visible || proposal?.status !== 'applied') && (
        <FormSteps label="Ledger setup steps" steps={REGISTER_SETUP_STEPS} current={phase} />
      )}
      <View style={[look.fields, !editable && look.hidden]}>
        <Problems problems={model.attempted ? (phase === 'details' ? model.detailProblems : model.problems) : []} />
        <View style={[look.fields, phase !== 'details' && look.hidden]}>
          {classFields ??
            (register && (
              <Rows>
                <Fact label="Share class">{register.token.name}</Fact>
                <Fact label="Class code">{register.token.symbol}</Fact>
              </Rows>
            ))}
          <Field
            label="Record date"
            value={draft.asAt}
            {...DATE}
            editable={!locked}
            onChange={(asAt) => model.update((current) => ({ ...current, asAt: asAt.trim() }))}
          />
          {!!correction && (
            <>
              <Field
                label="Reason for correcting the mirror"
                value={draft.reason}
                multiline
                rows={2}
                maxLength={FIELD_LIMITS.REASON}
                editable={!locked}
                onChange={(reason) => model.update((current) => ({ ...current, reason }))}
              />
              <Text style={look.muted}>
                This corrects a copied opening. The earlier snapshot and evidence remain in history. It does not change
                the company’s legal records.
              </Text>
            </>
          )}
        </View>
        <View style={[look.fields, phase !== 'shareholders' && look.hidden]}>
          <ImportShareholders
            draft={draft}
            locked={locked}
            differs={model.differs}
            update={model.update}
            setMember={model.setMember}
            companyMembers={model.knownMembers}
            preserveParticulars={model.preserveParticulars}
            validateMember={model.holderProblems}
            onEditorChange={model.setHolderEditor}
          />
          {emptyOpeningAllowed && !correction && draft.members.length === 0 && (
            <Text style={look.muted}>
              If no shares have been issued, continue with no shareholders. Confirming records an empty opening; the
              first share issue is a separate company decision.
            </Text>
          )}
        </View>
      </View>
      {visible && mutable && !canPrepare && <Text style={look.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {visible && !mutable && proposal && (
        <View
          accessibilityLabel={proposal.status === 'applied' ? 'Recorded ledger' : 'Review ledger'}
          style={look.fields}
        >
          {proposal.status === 'applied' && <Status tone="done">Recorded</Status>}
          <Rows>
            <Fact label="Record date" inline>
              {formatShortDate(proposal.asAt)}
            </Fact>
            <Fact label="Shares held" inline>
              {total}
            </Fact>
            <Fact label="Shareholders" inline>
              {String(proposal.members.length)}
            </Fact>
          </Rows>
          {!!proposal.correctionOf && <Text style={look.muted}>Correction: {proposal.reason}</Text>}
          {supporting && (
            <ShowMore show="Show supporting records" hide="Hide supporting records">
              <Rows>
                {(proposal.sourceReference || proposal.authorityReference) !== SOURCE && (
                  <Fact label="Source record" inline>
                    {proposal.sourceReference || proposal.authorityReference}
                  </Fact>
                )}
                {proposal.asicIssuedTotal !== null && (
                  <Fact label="ASIC issued shares cross-check" inline>
                    {formatShareCount(proposal.asicIssuedTotal)}
                  </Fact>
                )}
                {proposal.asicMemberCount !== null && (
                  <Fact label="Shareholders listed by ASIC" inline>
                    {String(proposal.asicMemberCount)}
                  </Fact>
                )}
                {!!proposal.registerEvidence && (
                  <Fact label="Source copy" inline>
                    Retained company-provided register copy
                  </Fact>
                )}
                {!!proposal.asicEvidence && (
                  <Fact label="ASIC copy" inline>
                    Retained company-provided extract
                  </Fact>
                )}
              </Rows>
            </ShowMore>
          )}
          <MemberRecords members={proposal.members} />
          {proposal.formerMembers.length > 0 && (
            <Rows>
              {proposal.formerMembers.map((member, index) => (
                <View key={index} style={look.row}>
                  <MemberRow
                    name={member.name}
                    shares={shareCount(member.shares)}
                    address={member.residentialAddress}
                    facts={`Former shareholder · Ceased ${formatShortDate(member.ceasedOn)}`}
                  />
                </View>
              ))}
            </Rows>
          )}
          {proposal.status === 'submitted' && canPrepare && !!steps.reject && (
            <Text style={look.small}>
              Editing retires this prepared draft before saving a replacement. Confirmed mirrors and earlier evidence
              stay unchanged.
            </Text>
          )}
          {proposal.status === 'submitted' && !steps[kind] && (
            <Text style={look.muted}>
              {kind === 'apply'
                ? 'These records are reviewed. A company appointee with confirmation access must confirm the mirror before ownership is recorded.'
                : 'These records are saved. A company appointee with review access must review them before confirmation.'}
            </Text>
          )}
          {proposal.status === 'submitted' && !!proposal.correctionOf && !!model.preview && (
            <View accessibilityLabel="Correction compared with the current mirror" style={look.fields}>
              <Text style={look.muted}>Correction compared with the current mirror</Text>
              <Rows>
                {model.preview.comparison.map((row) => (
                  <View key={row.member} style={look.summary}>
                    <Text style={look.title}>{row.name ?? row.liveName ?? 'Earlier shareholder'}</Text>
                    <Fact label="Before">
                      {`${row.stored === null ? 'Not held' : formatShareCount(row.stored)} · ${formatDate(row.enteredOn, 'Not recorded')}`}
                    </Fact>
                    <Fact label="After">
                      {`${row.imported === null ? 'Not held' : formatShareCount(row.imported)} · ${formatDate(row.importedEnteredOn, 'Not recorded')}`}
                    </Fact>
                  </View>
                ))}
              </Rows>
            </View>
          )}
          {proposal.status === 'submitted' && !!model.preview?.unmetRequirements.length && (
            <View accessibilityRole="alert" style={look.terms}>
              {refusalSentences(model.preview.unmetRequirements, REGISTER_IMPORT_DECISIONS.unmet).map((sentence) => (
                <Text key={sentence} style={styles.error}>
                  {sentence}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
      {uncertain && (
        <View style={look.list}>
          <Text style={look.muted}>
            The save result is uncertain. Keep the original details and recover the same request.
          </Text>
          <Action label="Recover saved records" disabled={busy} onPress={() => void model.prepare(true)} />
        </View>
      )}
      {!!recovery && (
        <View style={look.list}>
          <Text style={look.muted}>
            The confirmation result is uncertain. Recover the original request before continuing.
          </Text>
          <Action label="Recover confirmation" disabled={deciding} onPress={() => void recovery.recover()} />
        </View>
      )}
      {model.errors.map((message, index) => (
        <Text key={index} accessibilityRole="alert" style={styles.error}>
          {message}
        </Text>
      ))}
      {!visible && (
        <Text style={look.muted}>
          Refresh current company access before showing these records or starting another action.
        </Text>
      )}
      {!model.holderEditor && (
        <FormActions>
          {editable && !uncertain && phase === 'shareholders' && (
            <Action
              label="Back"
              accessibilityLabel="Back (share details)"
              disabled={locked}
              onPress={() => {
                Keyboard.dismiss();
                model.setAttempted(false);
                model.setPhase('details');
              }}
            />
          )}
          {reviewing && (
            <Action
              label={model.editing ? 'Reopening records…' : 'Edit records'}
              disabled={deciding || !!recovery || autoApply || !canPrepare || !steps.reject || blocked}
              onPress={() => {
                model.setEditing(true);
                void model.reject.open('reject', 'Replaced while editing the copied records.');
              }}
            />
          )}
          {reviewing && !model.currentTarget && !recovery && (
            <Action
              label={
                running !== 'confirm' && model.decision.busy && !autoApply
                  ? 'Loading confirmation…'
                  : 'Load confirmation'
              }
              disabled={busy || deciding || autoApply || blocked || !steps[kind]}
              onPress={() => void model.loadPreview()}
            />
          )}
          {!recorded && !(editable && !uncertain && phase === 'shareholders') && (
            <Action
              label="Cancel"
              accessibilityLabel="Cancel (ledger setup)"
              disabled={busy || uncertain || deciding || !!recovery || autoApply || model.editing}
              onPress={() => {
                Keyboard.dismiss();
                onCancel();
              }}
            />
          )}
          {editable && !uncertain && (
            <Action
              primary
              label={phase === 'details' ? 'Continue' : busy ? 'Saving draft…' : 'Save draft and review'}
              disabled={locked}
              onPress={submit}
            />
          )}
          {reviewing && !recovery && (
            <Action
              primary
              label={
                running === 'confirm' || (autoApply && deciding)
                  ? 'Confirming…'
                  : kind === 'approve' && !steps.apply
                    ? 'Record review'
                    : 'Confirm'
              }
              disabled={!model.ready || deciding || autoApply}
              onPress={() => track('confirm', model.decision.confirm())}
            />
          )}
          {recorded && (
            <Action
              primary
              label={running === 'finish' ? 'Opening company ownership…' : 'View company ownership'}
              disabled={running === 'finish'}
              onPress={() => track('finish', model.finish())}
            />
          )}
        </FormActions>
      )}
    </Section>
  );
}

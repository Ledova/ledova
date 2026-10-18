import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  formatDateToString,
  formatShareCount,
  getErrorMessage,
  isPreparedRegisterImport,
  prepareRegisterImport,
  REGISTER_IMPORT_COPY,
  registerImportMoney,
  registerImportTotals,
  wholeShares,
  type RegisterImportAllotment,
  type RegisterImportCurrentMemberRow,
  type RegisterImportPreparation,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { EvidencePicker, Field, isoDay } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { importsKey, useClassRegister, useRegisterAppointments, useRegisterImports } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

type AllotmentDraft = Omit<
  RegisterImportAllotment,
  'fullyPaid' | 'beneficiallyHeld' | 'shareReference' | 'certificateReference'
> & {
  shareReference: string;
  certificateReference: string;
  beneficiallyHeld: boolean | null;
};
type MemberDraft = Omit<RegisterImportCurrentMemberRow, 'allotments'> & { allotments: AllotmentDraft[] };

const FAILED = 'The records could not be prepared. Retry with the same details.';
const blankAllotment = (): AllotmentDraft => ({
  allottedOn: '',
  shares: '',
  shareReference: '',
  certificateReference: '',
  amountPaid: '',
  amountUnpaid: '',
  beneficiallyHeld: null,
});
const blankMember = (): MemberDraft => ({
  member: Crypto.randomUUID(),
  name: '',
  residentialAddress: '',
  shares: '',
  enteredOn: '',
  allotments: [blankAllotment()],
});
const positiveShares = (value: string) => {
  const shares = wholeShares(value.trim());
  return shares !== null && shares > 0n ? shares.toString() : '';
};

function AllotmentFields({
  row,
  label,
  busy,
  change,
}: {
  row: AllotmentDraft;
  label: string;
  busy: boolean;
  change: (value: Partial<AllotmentDraft>) => void;
}) {
  const styles = useCompanyStyles();
  const fields: { key: keyof Omit<AllotmentDraft, 'beneficiallyHeld'>; text: string; numeric?: boolean }[] = [
    { key: 'allottedOn', text: 'Original allotment date (YYYY-MM-DD)' },
    { key: 'shares', text: 'Shares from this allotment still held', numeric: true },
    { key: 'shareReference', text: 'Share numbers or reference, if recorded' },
    { key: 'certificateReference', text: 'Certificate reference, if recorded' },
    { key: 'amountPaid', text: 'Total amount paid on these shares', numeric: true },
    { key: 'amountUnpaid', text: 'Total amount unpaid on these shares', numeric: true },
  ];
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{label}</Text>
      {fields.map(({ key, text, numeric }) => (
        <Field
          key={key}
          label={text}
          accessibilityLabel={`${label} ${text}`}
          value={row[key]}
          editable={!busy}
          keyboardType={numeric ? 'decimal-pad' : undefined}
          onChange={(value) => change({ [key]: value })}
        />
      ))}
      {registerImportMoney(row.amountUnpaid) !== null && (
        <Text style={styles.muted}>
          {registerImportMoney(row.amountUnpaid) === '0.00' ? 'Fully paid' : 'Partly paid'}
        </Text>
      )}
      <Text style={styles.text}>Held for whose benefit?</Text>
      <View style={styles.choices}>
        <Choice
          label="Registered holder’s own benefit"
          accessibilityLabel={`${label} own benefit`}
          accessibilityRole="radio"
          selected={row.beneficiallyHeld === true}
          disabled={busy}
          onPress={() => change({ beneficiallyHeld: true })}
        />
        <Choice
          label="Someone else (trustee or nominee)"
          accessibilityLabel={`${label} someone else`}
          accessibilityRole="radio"
          selected={row.beneficiallyHeld === false}
          disabled={busy}
          onPress={() => change({ beneficiallyHeld: false })}
        />
      </View>
    </View>
  );
}

export function PrepareRegisterImportScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterImport key={epoch} epoch={epoch} />;
}

function PrepareRegisterImport({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { tokenUuid, companyUuid, correctionOf } =
    useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterImport'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const imports = useRegisterImports(epoch, companyUuid, tokenUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const shareRegister = useRegisterEvidence(companyUuid, 'share_register');
  const asicExtract = useRegisterEvidence(companyUuid, 'asic_extract');
  const [asAt, setAsAt] = useState(() => formatDateToString(new Date()));
  const [sourceReference, setSourceReference] = useState('');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [drafts, setDrafts] = useState<MemberDraft[]>([]);
  const [statedTotal, setStatedTotal] = useState('');
  const [statedCount, setStatedCount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const pending = useRef(false);
  const initialized = useRef(false);
  const retry = useRef<{ signature: string; operationId: string } | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const original = correctionOf
    ? imports.data?.find((row) => row.uuid === correctionOf && row.status === 'applied')
    : undefined;
  const opened = register.data?.initialized === true;
  useLayoutEffect(() => {
    if (initialized.current || !register.isSuccess || !imports.isSuccess || (correctionOf && !original)) return;
    initialized.current = true;
    if (original) {
      setAsAt(original.asAt);
      setSourceReference(original.sourceReference);
      setDrafts(
        original.members.map((row) => ({
          member: row.member,
          name: row.name,
          residentialAddress: row.residentialAddress,
          shares: row.shares,
          enteredOn: row.enteredOn,
          allotments:
            row.allotments?.map((allotment) => ({
              ...allotment,
              shareReference: allotment.shareReference ?? '',
              certificateReference: allotment.certificateReference ?? '',
            })) ?? [],
        })),
      );
    } else if (opened) {
      setDrafts(
        register.data.holders.map((holder) => ({
          member: holder.member,
          name: holder.name ?? '',
          residentialAddress: '',
          shares: holder.balance,
          enteredOn: '',
          allotments: [blankAllotment()],
        })),
      );
    }
  }, [register.isSuccess, register.data, imports.isSuccess, correctionOf, original, opened]);
  const members: RegisterImportCurrentMemberRow[] = drafts.map((row) => ({
    member: row.member,
    name: row.name.trim(),
    residentialAddress: row.residentialAddress.trim(),
    shares: positiveShares(row.shares),
    enteredOn: row.enteredOn.trim(),
    allotments: row.allotments.map((allotment) => ({
      allottedOn: allotment.allottedOn.trim(),
      shares: positiveShares(allotment.shares),
      shareReference: allotment.shareReference.trim() || null,
      certificateReference: allotment.certificateReference.trim() || null,
      amountPaid: registerImportMoney(allotment.amountPaid) ?? '',
      amountUnpaid: registerImportMoney(allotment.amountUnpaid) ?? '',
      fullyPaid: registerImportMoney(allotment.amountUnpaid) === '0.00',
      beneficiallyHeld: allotment.beneficiallyHeld === true,
    })),
  }));
  const date = asAt.trim();
  const dated = (value: string) => isoDay(value) && value <= date;
  const totals = registerImportTotals(members);
  const statedShares = statedTotal.trim() ? wholeShares(statedTotal.trim()) : null;
  const statedMembers = /^\d{1,9}$/.test(statedCount.trim()) ? Number(statedCount.trim()) : null;
  const mismatch = statedShares !== null && statedShares.toString() !== totals.total;
  const problem =
    !isoDay(date) || date > formatDateToString(new Date())
      ? 'Enter the snapshot date as YYYY-MM-DD, no later than today.'
      : !sourceReference.trim()
        ? 'Name the existing company register or records this snapshot came from.'
        : members.length === 0
          ? 'Add the current shareholders in this share class.'
          : members.some((row) => !row.name || !row.residentialAddress || !row.shares || !dated(row.enteredOn))
            ? 'Complete each shareholder’s name, address, shares and original entry date.'
            : members.some(
                  (row) =>
                    row.allotments.length === 0 ||
                    row.allotments.some(
                      (allotment) =>
                        !dated(allotment.allottedOn) ||
                        !allotment.shares ||
                        !allotment.amountPaid ||
                        !allotment.amountUnpaid,
                    ),
                )
              ? 'Record each underlying allotment’s date, shares still held and total paid and unpaid amounts. Enter zero where appropriate.'
              : drafts.some((row) => row.allotments.some((allotment) => allotment.beneficiallyHeld === null))
                ? 'State whether each allotment is held for the registered holder’s own benefit or someone else.'
                : members.some((row) => registerImportTotals(row.allotments).total !== row.shares)
                  ? 'The shares still held from each shareholder’s allotments must add up to their holding.'
                  : (statedTotal.trim() && statedShares === null) || (statedCount.trim() && statedMembers === null)
                    ? 'Enter whole numbers for the optional ASIC cross-check.'
                    : (statedTotal.trim() || statedCount.trim()) && !asicExtract.name
                      ? 'Optional ASIC figures need their extract copy. Add it or clear the figures.'
                      : !sourceConfirmed
                        ? 'Confirm that these records mirror the company’s existing legal register.'
                        : correctionOf && !reason.trim()
                          ? 'Explain the opening error being corrected.'
                          : null;
  const busy = submitting || shareRegister.busy || asicExtract.busy;
  const ready =
    !problem &&
    !mismatch &&
    !busy &&
    !!steps?.prepare &&
    register.isSuccess &&
    !register.isFetching &&
    imports.isSuccess &&
    !imports.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    (!correctionOf || !!original);
  const changeMember = (member: string, change: Partial<MemberDraft>) =>
    setDrafts((rows) => rows.map((row) => (row.member === member ? { ...row, ...change } : row)));
  const changeAllotment = (member: string, index: number, change: Partial<AllotmentDraft>) =>
    setDrafts((rows) =>
      rows.map((row) =>
        row.member === member
          ? {
              ...row,
              allotments: row.allotments.map((allotment, item) =>
                item === index ? { ...allotment, ...change } : allotment,
              ),
            }
          : row,
      ),
    );
  const pick = async (evidence: ReturnType<typeof useRegisterEvidence>) => {
    setError(null);
    try {
      await evidence.pick();
    } catch (cause) {
      if (live.current && epoch === getSessionEpoch())
        setError(getErrorMessage(cause, 'The document could not be selected. Try again.'));
    }
  };
  const submit = async () => {
    const appointment = steps?.prepare;
    if (!ready || !appointment || pending.current) return;
    const guard = () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('These records are no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      guard();
      const registerEvidence = shareRegister.name ? await shareRegister.upload(appointment.uuid, guard) : null;
      const asicEvidence = asicExtract.name ? await asicExtract.upload(appointment.uuid, guard) : null;
      const request: Omit<RegisterImportPreparation, 'operationId'> = {
        appointment: appointment.uuid,
        tokenId: tokenUuid,
        asAt: date,
        sourceReference: sourceReference.trim(),
        sourceConfirmed: true,
        members,
        formerMembers: original?.formerMembers ?? [],
        reason: correctionOf ? reason.trim() : 'Mirror the company’s existing register',
        ...(correctionOf ? { correctionOf } : {}),
        ...(registerEvidence ? { registerEvidence: registerEvidence.uuid } : {}),
        ...(asicEvidence
          ? {
              asicEvidence: asicEvidence.uuid,
              ...(statedShares !== null ? { asicIssuedTotal: statedShares.toString() } : {}),
              ...(statedMembers !== null ? { asicMemberCount: statedMembers } : {}),
            }
          : {}),
      };
      const signature = JSON.stringify(request);
      const operationId = retry.current?.signature === signature ? retry.current.operationId : Crypto.randomUUID();
      retry.current = { signature, operationId };
      const preparation: RegisterImportPreparation = { operationId, ...request };
      guard();
      const response = await prepareRegisterImport(apiClient, preparation, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (!isPreparedRegisterImport(response.data, preparation))
        throw createUserFriendlyError(REGISTER_IMPORT_COPY.PREPARATION_RECEIPT_FAILED);
      retry.current = null;
      await queryClient.invalidateQueries({ queryKey: importsKey(epoch, tokenUuid) });
      guard();
      navigation.goBack();
    } catch (cause) {
      const status = failureStatus(cause);
      if (status && status < 500) retry.current = null;
      try {
        guard();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, FAILED, FAILED));
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  const title = correctionOf ? REGISTER_IMPORT_COPY.CORRECT : REGISTER_IMPORT_COPY.PREPARE;
  if (register.isPending || imports.isPending || appointments.isPending)
    return (
      <Page title={title}>
        <Text style={styles.muted}>Loading the share class…</Text>
      </Page>
    );
  if (register.isError || imports.isError || appointments.isError)
    return (
      <Page title={title}>
        <Text accessibilityRole="alert" style={styles.error}>
          We couldn’t load this share class and your company appointments.
        </Text>
        <Action
          label="Retry"
          disabled={register.isFetching || imports.isFetching || appointments.isFetching}
          onPress={() => {
            void register.refetch();
            void imports.refetch();
            void appointments.refetch();
          }}
        />
      </Page>
    );
  if (correctionOf && !original)
    return (
      <Page title={title}>
        <Text accessibilityRole="alert" style={styles.error}>
          The confirmed opening snapshot could not be found. Return to the register and refresh.
        </Text>
      </Page>
    );
  if (!steps?.prepare)
    return (
      <Page title={title}>
        <Text style={styles.muted}>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  return (
    <Page
      testID="prepare-import-screen"
      title={title}
      lede={`${register.data.token.name}. ${REGISTER_IMPORT_COPY.MIRROR_NOTE}`}
      keyboardShouldPersistTaps="handled"
    >
      <Section title="Company records">
        <Field
          label="Existing register or source reference"
          value={sourceReference}
          editable={!busy}
          maxLength={255}
          onChange={setSourceReference}
        />
        <Field
          label="Snapshot date (YYYY-MM-DD)"
          accessibilityLabel="Register date"
          value={asAt}
          editable={!busy}
          onChange={setAsAt}
        />
        {correctionOf && (
          <Field
            label="What opening error are you correcting?"
            value={reason}
            editable={!busy}
            multiline
            maxLength={1000}
            onChange={setReason}
          />
        )}
      </Section>
      <Section title="Current shareholders">
        <Text style={styles.muted}>
          Copy the current holdings and original allotment particulars from the company’s records. No account or wallet
          is needed.
        </Text>
        {drafts.map((row, index) => {
          const number = index + 1;
          const fields = [
            { key: 'name' as const, label: 'Name' },
            { key: 'residentialAddress' as const, label: 'Address' },
            { key: 'enteredOn' as const, label: 'Original entry date (YYYY-MM-DD)' },
          ];
          return (
            <View key={row.member} style={[styles.entry, index === drafts.length - 1 && styles.lastEntry]}>
              <Text style={styles.heading}>Shareholder {number}</Text>
              {fields.map(({ key, label }) => (
                <Field
                  key={key}
                  label={label}
                  accessibilityLabel={`Shareholder ${number} ${label}`}
                  value={row[key]}
                  editable={!busy}
                  onChange={(value) => changeMember(row.member, { [key]: value })}
                />
              ))}
              <Field
                label="Current shares held"
                accessibilityLabel={`Shareholder ${number} shares`}
                value={row.shares}
                editable={!busy && (!opened || !!correctionOf)}
                keyboardType="number-pad"
                onChange={(value) => changeMember(row.member, { shares: value })}
              />
              {row.allotments.map((allotment, item) => (
                <View key={item} style={styles.group}>
                  <AllotmentFields
                    row={allotment}
                    label={`Shareholder ${number} · allotment ${item + 1}`}
                    busy={busy}
                    change={(change) => changeAllotment(row.member, item, change)}
                  />
                  <Action
                    label={`Remove allotment ${item + 1} for shareholder ${number}`}
                    disabled={busy}
                    onPress={() =>
                      changeMember(row.member, { allotments: row.allotments.filter((_, i) => i !== item) })
                    }
                  />
                </View>
              ))}
              {row.allotments.length === 0 && (
                <Text style={styles.muted}>
                  {REGISTER_IMPORT_COPY.UNKNOWN_ALLOTMENTS} Enter them from the source records before reviewing.
                </Text>
              )}
              <Action
                label={`Add an allotment for shareholder ${number}`}
                disabled={busy}
                onPress={() => changeMember(row.member, { allotments: [...row.allotments, blankAllotment()] })}
              />
              {(!opened || correctionOf) && (
                <Action
                  label={`Remove shareholder ${number}`}
                  disabled={busy}
                  onPress={() => setDrafts((rows) => rows.filter((item) => item.member !== row.member))}
                />
              )}
            </View>
          );
        })}
        {(!opened || correctionOf) && (
          <Action
            label="Add a shareholder"
            disabled={busy}
            onPress={() => setDrafts((rows) => [...rows, blankMember()])}
          />
        )}
      </Section>
      <Section title="Optional source documents">
        <Text style={styles.muted}>
          The source reference is enough to prepare a mirror. Documents, if supplied, stay company-provided and private.
        </Text>
        <EvidencePicker
          title="Share register (optional)"
          noun="share register"
          evidence={shareRegister}
          disabled={busy}
          onPick={() => void pick(shareRegister)}
        />
        <EvidencePicker
          title="ASIC extract (optional cross-check)"
          noun="ASIC extract"
          evidence={asicExtract}
          disabled={busy}
          onPick={() => void pick(asicExtract)}
        />
        {asicExtract.name && (
          <>
            <Field
              label="Issued total shown for this class"
              accessibilityLabel="ASIC issued total"
              value={statedTotal}
              editable={!busy}
              keyboardType="number-pad"
              onChange={setStatedTotal}
            />
            <Field
              label="Listed shareholders, if recorded (may be partial)"
              accessibilityLabel="ASIC listed shareholders"
              value={statedCount}
              editable={!busy}
              keyboardType="number-pad"
              onChange={setStatedCount}
            />
            <Text style={styles.muted}>
              ASIC may show only the top 20 shareholders. Its listed count does not have to match the full register.
            </Text>
          </>
        )}
      </Section>
      <Section title="Review">
        <Text style={styles.text}>
          {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
        </Text>
        {mismatch && (
          <Text accessibilityRole="alert" style={styles.error}>
            The optional ASIC issued total differs from the current holdings. Check the source records.
          </Text>
        )}
        <Choice
          label={REGISTER_IMPORT_COPY.SOURCE_CONFIRMATION}
          selected={sourceConfirmed}
          disabled={busy}
          onPress={() => setSourceConfirmed((value) => !value)}
        />
        {original && (
          <Text style={styles.muted}>
            This appends a correction to the opening. Earlier snapshots and retained history remain unchanged; later
            activity blocks an opening correction.
          </Text>
        )}
        {problem && <Text style={styles.muted}>{problem}</Text>}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Action
          label={submitting ? 'Preparing…' : 'Prepare for review'}
          primary
          disabled={!ready}
          onPress={() => void submit()}
        />
      </Section>
    </Page>
  );
}

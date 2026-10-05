import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  DESTINATIONS,
  formatDateToString,
  formatShareCount,
  getErrorMessage,
  isPreparedRegisterImport,
  prepareRegisterImport,
  REGISTER_IMPORT_COPY,
  registerImportTotals,
  wholeShares,
  type RegisterImportFormerRow,
  type RegisterImportMemberRow,
  type RegisterImportPreparation,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { useCompanyStyles } from './styles';
import { importsKey, useClassRegister, useImportAppointments } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

type Authority = RegisterImportPreparation['authority'];
type Particulars = { name: string; residentialAddress: string; enteredOn: string; amountPaid: string };
type MemberDraft = Particulars & { member: string; shares: string };
type FormerDraft = { key: number; name: string; residentialAddress: string; shares: string; ceasedOn: string };

const AUTHORITIES: [Authority, string][] = [
  ['director_resolution', 'Director resolution'],
  ['court_order', 'Court order'],
];
const MONEY = /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/;
const FAILED = 'The import could not be prepared. Retry with the same details.';

function isoDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return (
    !!match &&
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().startsWith(value)
  );
}

function positiveShares(value: string) {
  const shares = wholeShares(value.trim());
  return shares !== null && shares > 0n ? shares.toString() : '';
}

function Field({
  label,
  accessibilityLabel,
  value,
  editable,
  keyboardType,
  multiline,
  onChange,
}: {
  label: string;
  accessibilityLabel?: string;
  value: string;
  editable: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        style={styles.input}
        value={value}
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChange}
      />
    </View>
  );
}

function EvidencePicker({
  title,
  noun,
  evidence,
  disabled,
  onPick,
}: {
  title: string;
  noun: string;
  evidence: ReturnType<typeof useRegisterEvidence>;
  disabled: boolean;
  onPick: () => void;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.muted}>
        {evidence.name
          ? `${evidence.name}${evidence.uploaded ? ' · uploaded' : ''}`
          : 'Choose a PDF, PNG or JPEG up to 10 MB.'}
      </Text>
      <Action label={`${evidence.name ? 'Replace' : 'Choose'} the ${noun}`} disabled={disabled} onPress={onPick} />
      {!!evidence.name && <Action label={`Remove the ${noun}`} disabled={disabled} onPress={evidence.clear} />}
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
  const { tokenUuid, companyUuid } = useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterImport'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const { appointments, steps } = useImportAppointments(epoch, companyUuid);
  const shareRegister = useRegisterEvidence(companyUuid, 'share_register');
  const asicExtract = useRegisterEvidence(companyUuid, 'asic_extract');
  const [asAt, setAsAt] = useState(() => formatDateToString(new Date()));
  const [edits, setEdits] = useState<Record<string, Partial<Particulars>>>({});
  const [added, setAdded] = useState<MemberDraft[]>([]);
  const [former, setFormer] = useState<FormerDraft[]>([]);
  const [statedTotal, setStatedTotal] = useState('');
  const [statedCount, setStatedCount] = useState('');
  const [authority, setAuthority] = useState<Authority>('director_resolution');
  const [approvingDirector, setApprovingDirector] = useState('');
  const [authorityReference, setAuthorityReference] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const pending = useRef(false);
  const formerKeys = useRef(0);
  const retry = useRef<{ signature: string; operationId: string } | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const opened = register.data?.initialized === true;
  const drafts: MemberDraft[] = !register.data
    ? []
    : opened
      ? register.data.holders.map((holder) => ({
          member: holder.member,
          shares: holder.balance,
          name: edits[holder.member]?.name ?? holder.name ?? '',
          residentialAddress: edits[holder.member]?.residentialAddress ?? '',
          enteredOn: edits[holder.member]?.enteredOn ?? '',
          amountPaid: edits[holder.member]?.amountPaid ?? '',
        }))
      : added;
  const members: RegisterImportMemberRow[] = drafts.map((row) => ({
    member: row.member,
    name: row.name.trim(),
    residentialAddress: row.residentialAddress.trim(),
    shares: positiveShares(row.shares),
    enteredOn: row.enteredOn.trim(),
    amountPaid: row.amountPaid.trim() || null,
  }));
  const formerMembers: RegisterImportFormerRow[] = former.map((row) => ({
    name: row.name.trim(),
    residentialAddress: row.residentialAddress.trim(),
    shares: positiveShares(row.shares),
    ceasedOn: row.ceasedOn.trim(),
  }));
  const date = asAt.trim();
  const dated = (value: string) => isoDay(value) && value <= date;
  const totals = registerImportTotals(members);
  const statedShares = wholeShares(statedTotal.trim());
  const statedMembers = /^\d{1,9}$/.test(statedCount.trim()) ? Number(statedCount.trim()) : null;
  const mismatch =
    statedShares !== null &&
    statedMembers !== null &&
    (statedShares.toString() !== totals.total || statedMembers !== totals.count);
  const problem = !shareRegister.name
    ? 'Choose the company’s share register.'
    : !asicExtract.name
      ? 'Choose the ASIC extract.'
      : !isoDay(date) || date > formatDateToString(new Date())
        ? 'Enter the register date as YYYY-MM-DD, no later than today.'
        : members.length === 0
          ? opened
            ? REGISTER_IMPORT_COPY.NO_HOLDERS
            : 'Add each current member of this class.'
          : members.some((row) => !row.name || !row.residentialAddress || !row.shares || !dated(row.enteredOn))
            ? 'Complete each current member’s name, residential address, shares and date entered, no later than the register date.'
            : members.some((row) => row.amountPaid !== null && !MONEY.test(row.amountPaid))
              ? 'Enter each amount paid as a plain amount such as 250.00, or leave it blank when it is not known.'
              : formerMembers.some((row) => !row.name || !row.residentialAddress || !row.shares || !dated(row.ceasedOn))
                ? 'Complete each former member’s name, residential address, shares and date ceased, no later than the register date.'
                : statedShares === null || statedMembers === null
                  ? 'State the issued total and member count the ASIC extract shows for this class.'
                  : authority === 'director_resolution' && !approvingDirector.trim()
                    ? 'Name the director who approved the resolution.'
                    : !authorityReference.trim() || !reason.trim()
                      ? 'Enter the authority reference and the reason for the import.'
                      : null;
  const busy = submitting || shareRegister.busy || asicExtract.busy;
  const ready =
    !problem &&
    !mismatch &&
    !busy &&
    !!steps?.prepare &&
    register.isSuccess &&
    !register.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching;
  const changeMember = (member: string, change: Partial<MemberDraft>) => {
    if (opened) setEdits((current) => ({ ...current, [member]: { ...current[member], ...change } }));
    else setAdded((rows) => rows.map((row) => (row.member === member ? { ...row, ...change } : row)));
  };
  const changeFormer = (key: number, change: Partial<FormerDraft>) =>
    setFormer((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
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
    if (!ready || !appointment || statedShares === null || statedMembers === null || pending.current) return;
    const guard = () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('This import is no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      guard();
      const registerEvidence = await shareRegister.upload(appointment.uuid, guard);
      const asicEvidence = await asicExtract.upload(appointment.uuid, guard);
      const request = {
        appointment: appointment.uuid,
        tokenId: tokenUuid,
        registerEvidence: registerEvidence.uuid,
        asicEvidence: asicEvidence.uuid,
        asicIssuedTotal: statedShares.toString(),
        asicMemberCount: statedMembers,
        asAt: date,
        members,
        formerMembers,
        authority,
        approvingDirector: authority === 'director_resolution' ? approvingDirector.trim() : '',
        authorityReference: authorityReference.trim(),
        reason: reason.trim(),
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
      const status = (cause as { response?: { status?: number } })?.response?.status;
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
  const title = DESTINATIONS.companyRegisterImport.title;
  if (register.isPending || appointments.isPending)
    return (
      <Page title={title}>
        <Text style={styles.muted}>Loading the share class…</Text>
      </Page>
    );
  if (register.isError || appointments.isError)
    return (
      <Page title={title}>
        <Text accessibilityRole="alert" style={styles.error}>
          We couldn’t load this share class and your appointments.
        </Text>
        <Action
          label="Retry"
          disabled={register.isFetching || appointments.isFetching}
          onPress={() => {
            void register.refetch();
            void appointments.refetch();
          }}
        />
      </Page>
    );
  const name = register.data.token.name;
  if (!steps?.prepare)
    return (
      <Page title={title} lede={`${REGISTER_IMPORT_COPY.PREPARE} for ${name}.`}>
        <Text style={styles.muted}>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  return (
    <Page
      testID="prepare-import-screen"
      title={title}
      lede={`${REGISTER_IMPORT_COPY.PREPARE} for ${name}. The company provides its current share register and ASIC extract; Ledova staff verify neither, and each copy is shown as provided by the company.`}
      keyboardShouldPersistTaps="handled"
    >
      <Section title="Evidence">
        <EvidencePicker
          title="Share register"
          noun="share register"
          evidence={shareRegister}
          disabled={busy}
          onPick={() => void pick(shareRegister)}
        />
        <EvidencePicker
          title="ASIC extract"
          noun="ASIC extract"
          evidence={asicExtract}
          disabled={busy}
          onPick={() => void pick(asicExtract)}
        />
        <Field
          label="Register date (YYYY-MM-DD)"
          accessibilityLabel="Register date"
          value={asAt}
          editable={!busy}
          onChange={setAsAt}
        />
      </Section>
      <Section title="Current members">
        {!opened && <Text style={styles.muted}>{REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE}</Text>}
        <Text style={styles.muted}>
          {!opened
            ? 'Add each current member in the company’s register, with their shares. Each gets a new member ID.'
            : drafts.length > 0
              ? 'Each current member of the stored register, with the shares it records. Enter their particulars from the company’s register.'
              : REGISTER_IMPORT_COPY.NO_HOLDERS}
        </Text>
        {drafts.map((row, index) => {
          const number = index + 1;
          return (
            <View key={row.member} style={[styles.entry, index === drafts.length - 1 && styles.lastEntry]}>
              <Text style={styles.heading}>Member {number}</Text>
              <Text selectable style={styles.muted}>
                Member ID {row.member}
              </Text>
              {opened ? (
                <Text style={styles.text}>
                  {formatShareCount(row.shares)} {row.shares === '1' ? 'share' : 'shares'}
                </Text>
              ) : (
                <Field
                  label="Shares"
                  accessibilityLabel={`Member ${number} shares`}
                  value={row.shares}
                  editable={!busy}
                  keyboardType="number-pad"
                  onChange={(value) => changeMember(row.member, { shares: value })}
                />
              )}
              <Field
                label="Name"
                accessibilityLabel={`Member ${number} name`}
                value={row.name}
                editable={!busy}
                onChange={(value) => changeMember(row.member, { name: value })}
              />
              <Field
                label="Residential address"
                accessibilityLabel={`Member ${number} residential address`}
                value={row.residentialAddress}
                editable={!busy}
                onChange={(value) => changeMember(row.member, { residentialAddress: value })}
              />
              <Field
                label="Date entered (YYYY-MM-DD)"
                accessibilityLabel={`Member ${number} date entered`}
                value={row.enteredOn}
                editable={!busy}
                onChange={(value) => changeMember(row.member, { enteredOn: value })}
              />
              <Field
                label="Amount paid, if known"
                accessibilityLabel={`Member ${number} amount paid`}
                value={row.amountPaid}
                editable={!busy}
                keyboardType="decimal-pad"
                onChange={(value) => changeMember(row.member, { amountPaid: value })}
              />
              {!opened && (
                <Action
                  label={`Remove member ${number}`}
                  disabled={busy}
                  onPress={() => setAdded((rows) => rows.filter((item) => item.member !== row.member))}
                />
              )}
            </View>
          );
        })}
        {!opened && (
          <Action
            label="Add a member"
            disabled={busy}
            onPress={() =>
              setAdded((rows) => [
                ...rows,
                {
                  member: Crypto.randomUUID(),
                  shares: '',
                  name: '',
                  residentialAddress: '',
                  enteredOn: '',
                  amountPaid: '',
                },
              ])
            }
          />
        )}
      </Section>
      <Section title="Former members">
        <Text style={styles.muted}>
          Add the members who left before the register date, as the company’s register records them.
        </Text>
        {former.map((row, index) => {
          const number = index + 1;
          return (
            <View key={row.key} style={[styles.entry, index === former.length - 1 && styles.lastEntry]}>
              <Text style={styles.heading}>Former member {number}</Text>
              <Field
                label="Name"
                accessibilityLabel={`Former member ${number} name`}
                value={row.name}
                editable={!busy}
                onChange={(value) => changeFormer(row.key, { name: value })}
              />
              <Field
                label="Residential address"
                accessibilityLabel={`Former member ${number} residential address`}
                value={row.residentialAddress}
                editable={!busy}
                onChange={(value) => changeFormer(row.key, { residentialAddress: value })}
              />
              <Field
                label="Shares held when they ceased"
                accessibilityLabel={`Former member ${number} shares`}
                value={row.shares}
                editable={!busy}
                keyboardType="number-pad"
                onChange={(value) => changeFormer(row.key, { shares: value })}
              />
              <Field
                label="Date ceased (YYYY-MM-DD)"
                accessibilityLabel={`Former member ${number} date ceased`}
                value={row.ceasedOn}
                editable={!busy}
                onChange={(value) => changeFormer(row.key, { ceasedOn: value })}
              />
              <Action
                label={`Remove former member ${number}`}
                disabled={busy}
                onPress={() => setFormer((rows) => rows.filter((item) => item.key !== row.key))}
              />
            </View>
          );
        })}
        <Action
          label="Add a former member"
          disabled={busy}
          onPress={() => {
            formerKeys.current += 1;
            const key = formerKeys.current;
            setFormer((rows) => [...rows, { key, name: '', residentialAddress: '', shares: '', ceasedOn: '' }]);
          }}
        />
      </Section>
      <Section title="ASIC extract figures">
        <Text style={styles.muted}>State the issued total and member count the ASIC extract shows for this class.</Text>
        <Field
          label="Issued shares"
          accessibilityLabel="ASIC issued total"
          value={statedTotal}
          editable={!busy}
          keyboardType="number-pad"
          onChange={setStatedTotal}
        />
        <Field
          label="Members"
          accessibilityLabel="ASIC member count"
          value={statedCount}
          editable={!busy}
          keyboardType="number-pad"
          onChange={setStatedCount}
        />
        {statedShares !== null && statedMembers !== null && (
          <Text style={styles.text}>
            {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(statedShares.toString()), statedMembers)}
          </Text>
        )}
        <Text style={styles.text}>
          {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
        </Text>
        {mismatch && (
          <Text accessibilityRole="alert" style={styles.error}>
            The ASIC extract figures differ from the import rows. Correct them before preparing the import.
          </Text>
        )}
      </Section>
      <Section title="Authority">
        <View style={styles.choices}>
          {AUTHORITIES.map(([value, label]) => (
            <Choice
              key={value}
              label={label}
              accessibilityRole="radio"
              selected={authority === value}
              disabled={busy}
              onPress={() => setAuthority(value)}
            />
          ))}
        </View>
        {authority === 'director_resolution' && (
          <Field
            label="Approving director"
            value={approvingDirector}
            editable={!busy}
            onChange={setApprovingDirector}
          />
        )}
        <Field
          label="Authority reference"
          value={authorityReference}
          editable={!busy}
          onChange={setAuthorityReference}
        />
        <Field label="Reason" value={reason} editable={!busy} multiline onChange={setReason} />
        {problem && <Text style={styles.muted}>{problem}</Text>}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.muted}>
          If a response is interrupted, prepare again without changing anything to retrieve the same import. Any change
          prepares a new one.
        </Text>
        <Action
          label={submitting ? 'Preparing…' : REGISTER_IMPORT_COPY.PREPARE}
          primary
          disabled={!ready}
          onPress={() => void submit()}
        />
      </Section>
    </Page>
  );
}

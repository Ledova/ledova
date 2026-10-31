import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  CERTIFICATE_STATUSES,
  MEMBER_CERTIFICATE_STATUS_LABELS,
  REGISTER_CORRECTION_COPY,
  certificateStatus,
  formatDate,
  formatDateTime,
  searchRows,
  shareChange,
  type CertificateStatus,
  type MemberCertificateRequest,
  type OwnMemberRecord,
  type RegisterEntryKind,
  type useMemberRecords,
} from '@ledova/shared';
import { SelectField } from '../../components/SelectField';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, FormActions, Rows, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { CertificateCopy } from '../holdings/CertificateCopy';
import {
  MemberNotice,
  RecordGate,
  useCompanyRecord,
  useMemberRecordsState,
  useMemberRefresh,
} from '../holdings/MemberRecordsProvider';

type Read = ReturnType<typeof useMemberRecords>;
type Entry = Read['entries'][number];
type Filters = { token: string | null; search: string; status: CertificateStatus };

const MEMBER_STATUSES = CERTIFICATE_STATUSES.filter(([value]) => value !== 'can_prepare').map(([value, label]) => ({
  value,
  label,
}));
const companyDated = (entry: Entry) => ['issue', 'transfer'].includes(entry.kind.toLowerCase());
const receiving = (entry: Entry) => companyDated(entry) && BigInt(entry.delta) > 0n;
const statusLabel = (status: CertificateStatus) => CERTIFICATE_STATUSES.find(([value]) => value === status)?.[1];

function useCertificateStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    return {
      row: { gap: 12, paddingVertical: theme.spacing.md },
      change: { gap: theme.spacing.xs },
      line: { flexDirection: 'row' as const, gap: theme.spacing.md },
      name: { ...text, flex: 2, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      shares: { ...text, flex: 1, textAlign: 'right' as const, color: theme.colors.text.primary },
      text: { ...text, color: theme.colors.text.primary },
      muted: { ...text, color: theme.colors.text.muted },
      strong: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      actions: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        justifyContent: 'flex-end' as const,
        gap: theme.spacing.sm,
      },
      request: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        columnGap: theme.spacing.md,
        rowGap: theme.spacing.sm,
        paddingVertical: 12,
      },
      requestText: { flexShrink: 1, gap: theme.spacing.xs },
      requestActions: {
        marginLeft: 'auto' as const,
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        gap: theme.spacing.sm,
      },
      others: { gap: theme.spacing.sm },
      toggle: { ...text, color: theme.colors.brand.light },
      off: { opacity: 0.5 },
    };
  });
}

export function CertificatesScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Certificates'> }) {
  const styles = useCompanyStyles();
  const look = useCertificateStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { company, companies, selectCompany } = useMemberRecordsState();
  const openedCompany = route.params?.company;
  const opened =
    route.params?.record ?? companies.find((row) => row.company.uuid === openedCompany)?.uuid ?? openedCompany;
  const openedToken = route.params?.token;
  const [filters, setFilters] = useState<Filters>({ token: openedToken ?? null, search: '', status: 'all' });
  const [withdrawing, setWithdrawing] = useState<MemberCertificateRequest | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [otherShown, setOtherShown] = useState(false);
  const { read, record, selected, focused } = useCompanyRecord(opened ?? company?.uuid ?? '');
  useEffect(() => {
    if (!opened || !record || !selectCompany(record.company.uuid)) return;
    setFilters((current) =>
      current.token === (openedToken ?? null) && !current.search && current.status === 'all'
        ? current
        : { token: openedToken ?? null, search: '', status: 'all' },
    );
    navigation.setParams({ record: undefined, token: undefined, company: undefined });
  }, [opened, openedToken, record, selectCompany, navigation]);
  const refresh = useMemberRefresh(read, 'certificates-refresh');
  const shown = selected ?? record;
  const classes = shown?.classes ?? [];
  const token = filters.token ?? classes[0]?.uuid ?? null;
  const item = classes.find((row) => row.uuid === token);
  const { selectToken, selectedToken } = read;
  useEffect(() => {
    if (focused && selected && item && !read.busy && !read.retry && selectedToken !== item.uuid) selectToken(item.uuid);
  }, [focused, selected, item, read.busy, read.retry, selectedToken, selectToken]);
  const held = read.busy || !!read.retry;
  const unknownClass = !!selected && !!filters.token && !item;
  const own = !!item && selectedToken === item.uuid && read.entriesReady;
  const listed = !!selected && !!read.requests && !unknownClass && (classes.length === 0 || own);
  const filtered = !!filters.search || filters.status !== 'all';
  const requests = useMemo(
    () =>
      [...(selected ? (read.requests?.certificates ?? []) : [])].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.uuid.localeCompare(a.uuid),
      ),
    [selected, read.requests],
  );
  const statusOf = (entry: Entry) => certificateStatus({ uuid: entry.uuid, own: entry }, requests, token ?? undefined);
  const rows = searchRows(own ? read.entries : [], () => selected?.name ?? '', filters.search)
    .filter((entry) => filters.status === 'all' || statusOf(entry) === filters.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rowIds = new Set(rows.map((entry) => entry.uuid));
  const others = listed ? requests.filter((request) => request.token !== token || !rowIds.has(request.entry)) : [];
  const retry = read.retry;
  const otherActive =
    (retry?.kind === 'certificate' && others.some((request) => request.entry === retry.entry)) ||
    (retry?.kind === 'withdraw' && others.some((request) => request.uuid === retry.uuid));
  const otherOpen = otherShown || otherActive;
  const className = (request: MemberCertificateRequest) =>
    shown?.classes.find((row) => row.uuid === request.token)?.name ?? 'Share certificate';
  const actions = (request: MemberCertificateRequest) =>
    request.status === 'requested' ? (
      <Action
        label="Withdraw request"
        accessibilityLabel={`Withdraw request (requested ${formatDateTime(request.createdAt)})`}
        disabled={held}
        onPress={() => setWithdrawing(request)}
      />
    ) : request.status === 'fulfilled' && request.fulfilment ? (
      <CertificateCopy read={read} request={request} />
    ) : null;
  const requestRow = (request: MemberCertificateRequest) => {
    const action = actions(request);
    return (
      <View key={request.uuid} style={look.request}>
        <View style={look.requestText}>
          <Text style={look.strong}>
            {className(request)} · {MEMBER_CERTIFICATE_STATUS_LABELS[request.status]}
          </Text>
          <Text style={look.muted}>Requested {formatDate(request.createdAt)}</Text>
        </View>
        {action && <View style={look.requestActions}>{action}</View>}
      </View>
    );
  };
  const requestCertificate = (entry: Entry) => {
    setRunning(entry.uuid);
    void Promise.resolve(read.requestCertificate(entry.uuid)).finally(() => setRunning(null));
  };
  return (
    <Page
      testID="certificates-scroll"
      title="Certificates"
      titleAction={
        classes.length > 0 ? (
          <FilterPopover active={filtered}>
            {(close) => (
              <FilterFields
                record={shown}
                applied={{ token, search: filters.search, status: filters.status }}
                disabled={held}
                onApply={(next) => {
                  setFilters(next);
                  close();
                }}
              />
            )}
          </FilterPopover>
        ) : undefined
      }
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      {read.readFailed ? (
        <Action label="Try again" disabled={read.busy} onPress={() => void read.refresh()} />
      ) : !opened && !company ? (
        read.listReady ? (
          !read.error && <Text style={styles.muted}>Choose a company on Dashboard.</Text>
        ) : (
          <Text style={styles.muted}>Loading certificate records…</Text>
        )
      ) : (
        <RecordGate read={read} record={record} ready={!!selected}>
          <Section title="Certificate records">
            {unknownClass ? (
              <Text style={look.muted}>Your account has no member record for this share class.</Text>
            ) : !listed ? (
              <Text style={look.muted}>Loading your certificate records…</Text>
            ) : rows.length === 0 ? (
              <Text style={look.muted}>
                {filtered
                  ? 'No certificate records match these filters.'
                  : 'No eligible certificate records in the loaded entries.'}
              </Text>
            ) : (
              <Rows>
                {rows.map((entry) => {
                  const related = requests.filter((request) => request.entry === entry.uuid && request.token === token);
                  const latest = related[0];
                  const kind =
                    REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind.toLowerCase() as RegisterEntryKind] ??
                    'Register change';
                  const requestable = receiving(entry) && latest?.status !== 'requested';
                  const latestAction = latest && actions(latest);
                  return (
                    <View key={`${token}/${entry.uuid}`} style={look.row}>
                      <View style={look.change}>
                        <View style={look.line}>
                          <Text style={look.name}>{selected?.name ?? 'Shareholder'}</Text>
                          <Text style={look.shares}>
                            {shareChange(entry.delta)} {item?.symbol} shares
                          </Text>
                        </View>
                        <Text style={look.muted}>
                          {kind} · {item?.symbol} · entry {entry.sequence}
                        </Text>
                      </View>
                      <View>
                        <Text style={look.muted}>
                          {companyDated(entry)
                            ? formatDate(entry.companyEventOn, 'Not recorded')
                            : formatDate(entry.effectiveOn)}
                        </Text>
                        {companyDated(entry) && entry.effectiveOn !== entry.companyEventOn && (
                          <Text style={look.muted}>Ledger date {formatDate(entry.effectiveOn)}</Text>
                        )}
                      </View>
                      <View>
                        <Text style={look.muted}>
                          {latest?.status === 'requested'
                            ? `Requested ${formatDate(latest.createdAt)}`
                            : statusLabel(statusOf(entry))}
                        </Text>
                        {latest && latest.status !== 'requested' && (
                          <Text style={look.muted}>Requested {formatDate(latest.createdAt)}</Text>
                        )}
                      </View>
                      {(requestable || latestAction) && (
                        <View style={look.actions}>
                          {requestable && (
                            <Action
                              label={running === entry.uuid ? 'Requesting…' : 'Request certificate'}
                              accessibilityLabel={`${running === entry.uuid ? 'Requesting…' : 'Request certificate'} (${item?.name ?? 'Shares'}, entry ${entry.sequence})`}
                              disabled={held}
                              onPress={() => requestCertificate(entry)}
                            />
                          )}
                          {latestAction}
                        </View>
                      )}
                      {related.length > 1 && (
                        <Rows>
                          <Text accessibilityRole="header" style={look.strong}>
                            Earlier requests
                          </Text>
                          {related.slice(1).map(requestRow)}
                        </Rows>
                      )}
                    </View>
                  );
                })}
              </Rows>
            )}
            {others.length > 0 && (
              <View style={look.others}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: otherOpen, disabled: otherActive }}
                  disabled={otherActive}
                  hitSlop={12}
                  onPress={() => setOtherShown((open) => !open)}
                  style={otherActive && look.off}
                >
                  <Text style={look.toggle}>
                    {otherOpen
                      ? 'Hide other certificate requests'
                      : `Show other certificate requests (${others.length})`}
                  </Text>
                </Pressable>
                {otherOpen && <Rows>{others.map(requestRow)}</Rows>}
              </View>
            )}
          </Section>
        </RecordGate>
      )}
      {withdrawing && (
        <CustomModal
          visible
          title="Withdraw this certificate request?"
          busy={read.busy}
          onClose={() => setWithdrawing(null)}
          actions={
            <Action
              label={read.busy ? 'Withdrawing…' : 'Withdraw certificate request'}
              primary
              disabled={held}
              onPress={() => void Promise.resolve(read.withdraw(withdrawing.uuid)).finally(() => setWithdrawing(null))}
            />
          }
        >
          <Text style={look.text}>
            The company won’t fulfil your request of {formatDate(withdrawing.createdAt)}. You can request a certificate
            for the same entry again.
          </Text>
        </CustomModal>
      )}
    </Page>
  );
}

function FilterFields({
  record,
  applied,
  disabled,
  onApply,
}: {
  record: OwnMemberRecord | undefined;
  applied: Filters;
  disabled: boolean;
  onApply: (filters: Filters) => void;
}) {
  const [draft, setDraft] = useState(applied);
  const classes = record?.classes ?? [];
  const valid = classes.some((row) => row.uuid === draft.token);
  return (
    <>
      {classes.length > 1 && (
        <SelectField
          label="Share class"
          value={draft.token ?? ''}
          options={classes.map((row) => ({ value: row.uuid, label: `${row.name} · ${row.symbol}` }))}
          disabled={disabled}
          onChange={(token) => setDraft((current) => ({ ...current, token }))}
        />
      )}
      <Field
        label="Shareholder"
        value={draft.search}
        maxLength={100}
        editable={!disabled}
        autoCorrect={false}
        onChange={(search) => setDraft((current) => ({ ...current, search }))}
      />
      <SelectField
        label="Certificate status"
        value={draft.status}
        options={MEMBER_STATUSES}
        disabled={disabled}
        onChange={(status) => setDraft((current) => ({ ...current, status }))}
      />
      <FormActions>
        <Action
          label="Clear"
          accessibilityLabel="Clear (certificate filters)"
          disabled={disabled}
          onPress={() =>
            onApply({
              token: classes.some((row) => row.uuid === applied.token) ? applied.token : null,
              search: '',
              status: 'all',
            })
          }
        />
        <Action
          label="Apply"
          accessibilityLabel="Apply (certificate filters)"
          primary
          disabled={disabled || !valid}
          onPress={() => onApply({ ...draft, search: draft.search.trim() })}
        />
      </FormActions>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { FunnelIcon } from 'phosphor-react-native';
import {
  CERTIFICATE_STATUSES,
  MEMBER_CERTIFICATE_STATUS_LABELS,
  REGISTER_CORRECTION_COPY,
  certificateStatus,
  formatDate,
  shareChange,
  type CertificateStatus,
  type MemberCertificateRequest,
  type OwnMemberRecord,
  type RegisterEntryKind,
  type useMemberRecords,
} from '@ledova/shared';
import { Action, Choice, Rows, Section } from '../../components/Ledger';
import { CustomModal, useDialogStyles } from '../../components/modal';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';
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
type Filters = { token: string | null; status: CertificateStatus };

const MEMBER_STATUSES = CERTIFICATE_STATUSES.filter(([value]) => value !== 'can_prepare');
const companyDated = (entry: Entry) => ['issue', 'transfer'].includes(entry.kind.toLowerCase());
const receiving = (entry: Entry) => companyDated(entry) && BigInt(entry.delta) > 0n;
const statusLabel = (status: CertificateStatus) => CERTIFICATE_STATUSES.find(([value]) => value === status)?.[1];

function useCertificateStyles() {
  return useThemedStyles((theme) => ({
    filters: {
      width: 40,
      height: 40,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
    },
    row: { gap: 4, paddingVertical: 14 },
    line: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: theme.spacing.md },
    name: { flex: 1, fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    change: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.primary },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm, paddingTop: 6 },
    earlier: { gap: 4, paddingTop: theme.spacing.sm },
    heading: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    toggle: { paddingVertical: 6, fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.brand.light },
  }));
}

export function CertificatesScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Certificates'> }) {
  const styles = useCompanyStyles();
  const look = useCertificateStyles();
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { company, companies, selectCompany } = useMemberRecordsState();
  const opened = route.params?.record;
  const openedToken = route.params?.token;
  const [filters, setFilters] = useState<Filters>({ token: openedToken ?? null, status: 'all' });
  const [choosing, setChoosing] = useState(false);
  const [withdrawing, setWithdrawing] = useState<MemberCertificateRequest | null>(null);
  const [otherShown, setOtherShown] = useState(false);
  useEffect(() => {
    if (!opened) return;
    const target = companies.find((row) => row.uuid === opened);
    if (!target || !selectCompany(target.company.uuid)) return;
    setFilters((current) =>
      current.token === (openedToken ?? null) && current.status === 'all'
        ? current
        : { token: openedToken ?? null, status: 'all' },
    );
    navigation.setParams({ record: undefined, token: undefined });
  }, [opened, openedToken, companies, selectCompany, navigation]);
  const { read, selected, focused } = useCompanyRecord(company?.uuid ?? '');
  const refresh = useMemberRefresh(read, 'certificates-refresh');
  const classes = (selected ?? company)?.classes ?? [];
  const token = classes.some((row) => row.uuid === filters.token) ? filters.token! : classes[0]?.uuid;
  const item = classes.find((row) => row.uuid === token);
  const { selectToken, selectedToken } = read;
  useEffect(() => {
    if (focused && selected && token && !read.busy && !read.retry && selectedToken !== token) selectToken(token);
  }, [focused, selected, token, read.busy, read.retry, selectedToken, selectToken]);
  const held = read.busy || !!read.retry;
  const loaded = !!selected && !!token && selectedToken === token && read.entriesReady && !!read.requests;
  const requests = useMemo(
    () =>
      [...(selected ? (read.requests?.certificates ?? []) : [])].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.uuid.localeCompare(a.uuid),
      ),
    [selected, read.requests],
  );
  const entries = loaded ? read.entries : [];
  const statusOf = (entry: Entry) => certificateStatus({ uuid: entry.uuid, own: entry }, requests, token);
  const rows = entries
    .filter((entry) => filters.status === 'all' || statusOf(entry) === filters.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const listed = new Set(entries.map((entry) => entry.uuid));
  const others = loaded ? requests.filter((request) => request.token !== token || !listed.has(request.entry)) : [];
  const record = selected ?? company;
  const className = (request: MemberCertificateRequest) =>
    record?.classes.find((row) => row.uuid === request.token)?.name ?? 'Share certificate';
  const actions = (request: MemberCertificateRequest) =>
    request.status === 'requested' ? (
      <Action
        label="Withdraw request"
        accessibilityLabel={`Withdraw request, requested ${formatDate(request.createdAt)}`}
        disabled={held}
        onPress={() => setWithdrawing(request)}
      />
    ) : request.status === 'fulfilled' && request.fulfilment ? (
      <CertificateCopy read={read} request={request} />
    ) : null;
  const requestRow = (request: MemberCertificateRequest) => (
    <View key={request.uuid} style={look.earlier}>
      <Text style={look.heading}>
        {className(request)} · {MEMBER_CERTIFICATE_STATUS_LABELS[request.status]}
      </Text>
      <Text style={styles.muted}>Requested {formatDate(request.createdAt)}</Text>
      <View style={look.actions}>{actions(request)}</View>
    </View>
  );
  return (
    <Page
      testID="certificates-scroll"
      title="Certificates"
      titleAction={
        classes.length > 0 ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={filters.status === 'all' ? 'Filters' : 'Filters, active'}
            onPress={() => setChoosing(true)}
            hitSlop={2}
            style={look.filters}
          >
            <FunnelIcon size={theme.icon.sizes.md} color={theme.colors.text.primary} />
          </TouchableOpacity>
        ) : undefined
      }
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      {!company ? (
        read.listReady && !read.error ? (
          <Text style={styles.muted}>Choose a company on Dashboard.</Text>
        ) : (
          <Text style={styles.muted}>Loading certificate records…</Text>
        )
      ) : (
        <RecordGate read={read} record={company} ready={!!selected}>
          <Section title="Certificate records">
            {!loaded ? (
              read.readFailed ? null : (
                <Text style={styles.muted}>Loading certificate records…</Text>
              )
            ) : rows.length === 0 ? (
              <Text style={styles.muted}>
                {filters.status !== 'all'
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
                  return (
                    <View key={`${token}/${entry.uuid}`} style={look.row}>
                      <View style={look.line}>
                        <Text style={look.name}>{selected?.name ?? 'Shareholder'}</Text>
                        <Text style={look.change}>
                          {shareChange(entry.delta)} {item?.symbol} shares
                        </Text>
                      </View>
                      <Text style={styles.muted}>
                        {kind} · {item?.symbol} · entry {entry.sequence}
                      </Text>
                      <Text style={styles.muted}>
                        {companyDated(entry)
                          ? formatDate(entry.companyEventOn, 'Not recorded')
                          : formatDate(entry.effectiveOn)}
                        {companyDated(entry) && entry.effectiveOn !== entry.companyEventOn
                          ? ` · Ledger date ${formatDate(entry.effectiveOn)}`
                          : ''}
                      </Text>
                      <Text style={styles.muted}>
                        {latest?.status === 'requested'
                          ? `Requested ${formatDate(latest.createdAt)}`
                          : statusLabel(statusOf(entry))}
                        {latest && latest.status !== 'requested' ? ` · Requested ${formatDate(latest.createdAt)}` : ''}
                      </Text>
                      <View style={look.actions}>
                        {receiving(entry) && latest?.status !== 'requested' && (
                          <Action
                            label="Request certificate"
                            accessibilityLabel={`Request certificate, ${item?.name ?? 'Shares'}, entry ${entry.sequence}`}
                            disabled={held}
                            onPress={() => void read.requestCertificate(entry.uuid)}
                          />
                        )}
                        {latest && actions(latest)}
                      </View>
                      {related.length > 1 && (
                        <View style={look.earlier}>
                          <Text accessibilityRole="header" style={look.heading}>
                            Earlier requests
                          </Text>
                          {related.slice(1).map(requestRow)}
                        </View>
                      )}
                    </View>
                  );
                })}
              </Rows>
            )}
          </Section>
          {others.length > 0 && (
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: otherShown }}
                onPress={() => setOtherShown((shown) => !shown)}
              >
                <Text style={look.toggle}>
                  {otherShown
                    ? 'Hide other certificate requests'
                    : `Show other certificate requests (${others.length})`}
                </Text>
              </Pressable>
              {otherShown && <Rows>{others.map(requestRow)}</Rows>}
            </View>
          )}
        </RecordGate>
      )}
      <FiltersSheet
        visible={choosing}
        record={record}
        applied={{ token: token ?? null, status: filters.status }}
        onApply={(next) => {
          setFilters(next);
          setChoosing(false);
        }}
        onClose={() => setChoosing(false)}
      />
      {withdrawing && (
        <CustomModal
          visible
          title="Withdraw request"
          busy={read.busy}
          onClose={() => setWithdrawing(null)}
          cancelLabel="Keep request"
          onCancel={() => setWithdrawing(null)}
          actions={
            <Action
              label="Withdraw request"
              primary
              disabled={held}
              onPress={() => void Promise.resolve(read.withdraw(withdrawing.uuid)).finally(() => setWithdrawing(null))}
            />
          }
        >
          <Text style={styles.muted}>
            Withdraw the request made {formatDate(withdrawing.createdAt)}? The company stops preparing it.
          </Text>
        </CustomModal>
      )}
    </Page>
  );
}

function FiltersSheet({
  visible,
  record,
  applied,
  onApply,
  onClose,
}: {
  visible: boolean;
  record: OwnMemberRecord | undefined;
  applied: Filters;
  onApply: (filters: Filters) => void;
  onClose: () => void;
}) {
  const dialog = useDialogStyles();
  const [draft, setDraft] = useState(applied);
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setDraft(applied);
  }
  const classes = record?.classes ?? [];
  return (
    <CustomModal
      visible={visible}
      title="Filters"
      onClose={onClose}
      cancelLabel="Clear"
      onCancel={() => onApply({ token: applied.token, status: 'all' })}
      actions={<Action label="Apply" primary onPress={() => onApply(draft)} />}
    >
      {classes.length > 1 && (
        <View style={dialog.group}>
          <Text style={dialog.heading}>Share class</Text>
          {classes.map((row) => (
            <Choice
              key={row.uuid}
              label={`${row.name} · ${row.symbol}`}
              accessibilityRole="radio"
              selected={draft.token === row.uuid}
              onPress={() => setDraft((current) => ({ ...current, token: row.uuid }))}
            />
          ))}
        </View>
      )}
      <View style={dialog.group}>
        <Text style={dialog.heading}>Certificate status</Text>
        {MEMBER_STATUSES.map(([value, label]) => (
          <Choice
            key={value}
            label={label}
            accessibilityRole="radio"
            selected={draft.status === value}
            onPress={() => setDraft((current) => ({ ...current, status: value }))}
          />
        ))}
      </View>
    </CustomModal>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { formatDate } from '@ledova/shared';
import { Choice, Rows, useCardStyles } from '../../components/Ledger';
import { CustomModal, useDialogStyles } from '../../components/modal';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { TabParamList } from '../../navigation/SignedInNavigator';
import { CertificatePill } from '../holdings/CertificatePill';
import { CertificateSheet, entryDate, entryKind } from '../holdings/CertificateSheet';
import { Avatar } from '../holdings/CompanyHoldings';
import { shareQuantity, shortName } from '../holdings/holdings';
import { MemberNotice, useCompanyRecord, useMemberRecordsState } from '../holdings/MemberRecordsProvider';
import { NoticeList } from '../publications';
import { usePublications } from '../publications/usePublications';
import { useMemberCertificates, type MemberCertificate } from './useMemberCertificates';

type Kind = 'certificates' | 'notices';

function useDocumentStyles() {
  return useThemedStyles((theme) => ({
    choices: { flexDirection: 'row' as const, gap: theme.spacing.sm },
    chips: { gap: theme.spacing.sm },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd, paddingVertical: 12 },
    text: { flex: 1, gap: 2 },
  }));
}

function describe({ className, entry, request }: MemberCertificate) {
  return {
    title: `${className ?? 'Shares'}${entry ? ` · ${shareQuantity(entry.delta)}` : ''}`,
    detail: entry ? `${entryKind(entry)} · ${entryDate(entry)}` : `Requested ${formatDate(request.createdAt)}`,
    status: request.status === 'fulfilled' ? 'Ready' : 'Requested',
  };
}

function DocumentSheet({ certificate, onClose }: { certificate: MemberCertificate; onClose: () => void }) {
  const styles = useDialogStyles();
  const { read } = useCompanyRecord(certificate.record.uuid);
  const loaded = read.record?.uuid === certificate.record.uuid ? read.requests : null;
  const request = loaded?.certificates.find((row) => row.uuid === certificate.request.uuid);
  if (request)
    return (
      <CertificateSheet
        read={read}
        className={`${shortName(certificate.record.company.name)} · ${certificate.className ?? 'Shares'}`}
        request={request}
        onClose={onClose}
      />
    );
  return (
    <CustomModal visible title="Certificate" onClose={onClose} showFooter cancelLabel="Close">
      <Text style={styles.muted}>
        {read.retry
          ? 'Retry or finish your pending request before opening this certificate.'
          : read.readFailed
            ? 'This certificate could not be loaded. Refresh and try again.'
            : loaded
              ? 'This certificate is no longer recorded for you.'
              : 'Loading certificate…'}
      </Text>
    </CustomModal>
  );
}

export function DocumentsScreen({ route }: { route: RouteProp<TabParamList, 'Documents'> }) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const card = useCardStyles();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const { read } = useMemberRecordsState();
  const certificates = useMemberCertificates(read);
  const notices = usePublications();
  const [kind, setKind] = useState<Kind>('certificates');
  const [company, setCompany] = useState<string | null>(null);
  const [open, setOpen] = useState<MemberCertificate | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const preset = route.params?.company;
  useEffect(() => {
    if (!preset) return;
    setCompany(preset);
    navigation.setParams({ company: undefined });
  }, [preset, navigation]);
  const { refetch } = certificates;
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) void refetch();
      seen.current = true;
    }, [refetch]),
  );
  const companies = [...new Map(read.records.map((record) => [record.company.uuid, record.company])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  const chosen = companies.find((item) => item.uuid === company);
  const rows = certificates.certificates.filter((row) => !chosen || row.record.company.uuid === chosen.uuid);
  const shown = notices.publications.filter((publication) => !chosen || publication.companyName === chosen.name);
  const refresh = () => {
    if (read.busy || refreshing) return;
    setRefreshing(true);
    notices.retry();
    void Promise.all([read.refresh(), certificates.refetch()]).finally(() => setRefreshing(false));
  };
  return (
    <Page
      testID="documents-scroll"
      title="Documents"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.interactive.active} />
      }
    >
      <View style={look.choices}>
        <Choice label="Certificates" selected={kind === 'certificates'} onPress={() => setKind('certificates')} />
        <Choice label="Notices" selected={kind === 'notices'} onPress={() => setKind('notices')} />
      </View>
      {companies.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={look.chips}>
          <Choice label="All" selected={!chosen} onPress={() => setCompany(null)} />
          {companies.map((item) => (
            <Choice
              key={item.uuid}
              label={shortName(item.name)}
              accessibilityLabel={item.name}
              selected={chosen?.uuid === item.uuid}
              onPress={() => setCompany(item.uuid)}
            />
          ))}
        </ScrollView>
      )}
      {kind === 'notices' ? (
        <NoticeList notices={notices} publications={shown} />
      ) : (
        <>
          <MemberNotice read={read} />
          {certificates.failed && (
            <Text accessibilityRole="alert" style={styles.error}>
              Some certificates could not be loaded. Refresh before relying on this list.
            </Text>
          )}
          <View style={card.card}>
            {read.loading || certificates.loading ? (
              <Text style={styles.muted}>Loading certificates…</Text>
            ) : rows.length === 0 ? (
              <Text style={styles.muted}>{"No certificates yet. Request one from a share class's history."}</Text>
            ) : (
              <Rows>
                {rows.map((row) => {
                  const { title, detail, status } = describe(row);
                  return (
                    <Pressable
                      key={row.request.uuid}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.record.company.name}: ${title}, ${detail}, ${status}`}
                      onPress={() => setOpen(row)}
                      style={look.row}
                    >
                      <Avatar name={row.record.company.name} />
                      <View style={look.text}>
                        <Text style={styles.text}>{title}</Text>
                        <Text style={styles.muted}>{detail}</Text>
                      </View>
                      <CertificatePill certificate={status === 'Ready' ? 'ready' : 'requested'} label={status} />
                    </Pressable>
                  );
                })}
              </Rows>
            )}
          </View>
        </>
      )}
      {open && (
        <DocumentSheet
          certificate={open}
          onClose={() => {
            setOpen(null);
            void certificates.refetch();
          }}
        />
      )}
    </Page>
  );
}

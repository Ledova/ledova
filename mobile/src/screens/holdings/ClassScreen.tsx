import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import {
  MEMBER_CERTIFICATE_STATUS_LABELS,
  formatDate,
  shareChange,
  type MemberCertificateRequest,
} from '@ledova/shared';
import { Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import {
  CertificateSheet,
  certificateOf,
  currentRequest,
  entryDate,
  entryKind,
  type Certificate,
} from './CertificateSheet';
import { CertificatePill } from './CertificatePill';
import { Figure } from './Figure';
import { shareQuantity } from './holdings';
import { MemberNotice, RecordGate, useCompanyRecord, useMemberRefresh } from './MemberRecordsProvider';

const PILLS: Record<Exclude<Certificate, null>, string> = {
  ready: 'Certificate',
  requested: 'Requested',
  request: 'Request',
  other: 'Certificate request',
};

function useClassStyles() {
  return useThemedStyles((theme) => ({
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd, paddingVertical: 12 },
    text: { flex: 1, gap: 2 },
    change: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
  }));
}

function pillLabel(certificate: Exclude<Certificate, null>, request?: MemberCertificateRequest) {
  return certificate === 'other' && request ? MEMBER_CERTIFICATE_STATUS_LABELS[request.status] : PILLS[certificate];
}

type Sheet = { entry?: string; request?: string };

export function ClassScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Class'> }) {
  const styles = useCompanyStyles();
  const look = useClassStyles();
  const { token } = route.params;
  const { read, record, selected, focused } = useCompanyRecord(route.params.record);
  const { selectToken, selectedToken } = read;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const refresh = useMemberRefresh(read, 'class-scroll-refresh');
  const item = (selected ?? record)?.classes.find((row) => row.uuid === token);
  useEffect(() => {
    if (focused && selected && !read.busy && !read.retry && selectedToken !== token) selectToken(token);
  }, [focused, selected, read.busy, read.retry, selectedToken, selectToken, token]);
  const showing = !!selected && selectedToken === token;
  const loaded = showing && read.entriesReady && !!read.requests;
  const entries = loaded ? [...read.entries].sort((a, b) => b.sequence - a.sequence) : [];
  const requests = [...(read.requests?.certificates ?? [])]
    .filter((request) => request.token === token)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const entryIds = new Set(entries.map((entry) => entry.uuid));
  const unlisted = loaded ? requests.filter((request) => !entryIds.has(request.entry)) : [];
  const sheetEntry = sheet?.entry ? entries.find((entry) => entry.uuid === sheet.entry) : undefined;
  const forEntry = (uuid: string) => requests.filter((request) => request.entry === uuid);
  const sheetRequests = sheetEntry ? forEntry(sheetEntry.uuid) : [];
  const sheetRequest = sheetEntry
    ? currentRequest(sheetRequests)
    : requests.find((request) => request.uuid === sheet?.request);
  return (
    <Page
      testID="class-scroll"
      title={item ? `${item.name} shares` : 'Shares'}
      lede={record?.company.name}
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      <RecordGate read={read} record={record} ready={!!selected}>
        {!item ? (
          <Text style={styles.muted}>This share class is no longer recorded for you.</Text>
        ) : (
          <>
            <Figure
              value={shareQuantity(item.shares)}
              caption={item.ceasedOn ? `shares · ceased ${formatDate(item.ceasedOn)}` : 'shares held'}
            />
            <Section title="History">
              {!showing && read.retry ? (
                <Text style={styles.muted}>Retry or finish your pending request to see this history.</Text>
              ) : !loaded ? (
                read.readFailed ? null : (
                  <Text style={styles.muted}>Loading history…</Text>
                )
              ) : entries.length === 0 ? (
                <Text style={styles.muted}>No changes recorded for this class.</Text>
              ) : (
                <Rows>
                  {entries.map((entry) => {
                    const latest = currentRequest(forEntry(entry.uuid));
                    const certificate = certificateOf(entry, latest);
                    const content = (
                      <>
                        <View style={look.text}>
                          <Text style={styles.text}>{entryKind(entry)}</Text>
                          <Text style={styles.muted}>{entryDate(entry)}</Text>
                        </View>
                        <Text style={look.change}>{shareChange(entry.delta)}</Text>
                        {certificate && (
                          <CertificatePill certificate={certificate} label={pillLabel(certificate, latest)} />
                        )}
                      </>
                    );
                    return certificate ? (
                      <Pressable
                        key={entry.uuid}
                        accessibilityRole="button"
                        accessibilityLabel={`Entry ${entry.sequence}: ${entryKind(entry)} ${shareChange(entry.delta)}, ${entryDate(entry)}, certificate ${pillLabel(certificate, latest)}`}
                        onPress={() => setSheet({ entry: entry.uuid })}
                        style={look.row}
                      >
                        {content}
                      </Pressable>
                    ) : (
                      <View key={entry.uuid} style={look.row}>
                        {content}
                      </View>
                    );
                  })}
                </Rows>
              )}
            </Section>
            {unlisted.length > 0 && (
              <Section title="Other certificate requests">
                <Rows>
                  {unlisted.map((request) => (
                    <Pressable
                      key={request.uuid}
                      accessibilityRole="button"
                      accessibilityLabel={`Certificate request ${formatDate(request.createdAt)}, ${MEMBER_CERTIFICATE_STATUS_LABELS[request.status]}`}
                      onPress={() => setSheet({ request: request.uuid })}
                      style={look.row}
                    >
                      <View style={look.text}>
                        <Text style={styles.text}>Requested {formatDate(request.createdAt)}</Text>
                      </View>
                      <CertificatePill
                        certificate={certificateOf(undefined, request) ?? 'other'}
                        label={pillLabel(certificateOf(undefined, request) ?? 'other', request)}
                      />
                    </Pressable>
                  ))}
                </Rows>
              </Section>
            )}
            {sheet && (sheetEntry || sheetRequest) && (
              <CertificateSheet
                read={read}
                className={item.name}
                entry={sheetEntry}
                request={sheetRequest}
                others={sheetRequests.filter((request) => request !== sheetRequest)}
                onClose={() => setSheet(null)}
              />
            )}
          </>
        )}
      </RecordGate>
    </Page>
  );
}

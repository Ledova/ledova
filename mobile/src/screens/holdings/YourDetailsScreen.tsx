import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useIsFocused, useNavigation, type NavigationProp } from '@react-navigation/native';
import { CaretRightIcon } from 'phosphor-react-native';
import { Action, Choice, Rows, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { CertificatePill } from './CertificatePill';
import { Avatar } from './CompanyHoldings';
import { shortName } from './holdings';
import { MemberNotice, useMemberRecordsState } from './MemberRecordsProvider';
import { useMemberParticulars } from './useMemberParticulars';

interface Batch {
  name: string;
  address: string;
  queue: string[];
  stopped: string | null;
}

export function YourDetailsScreen() {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const card = useCardStyles();
  const look = useThemedStyles((theme) => ({
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd, paddingVertical: 12 },
    text: { flex: 1, gap: 2 },
    name: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    group: { gap: theme.spacing.smd },
  }));
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { read, select } = useMemberRecordsState();
  const focused = useIsFocused();
  const particulars = useMemberParticulars(read);
  const [form, setForm] = useState<{ name: string; address: string; confirmed: boolean } | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const sending = useRef(false);
  const companies = [...read.records].sort((a, b) => a.company.name.localeCompare(b.company.name));
  const nameOf = (uuid: string | null | undefined) =>
    shortName(read.records.find((record) => record.uuid === uuid)?.company.name ?? 'this company');
  const { requestParticulars, selectedUuid } = read;
  const { refetch } = particulars;
  useEffect(() => {
    if (!batch || batch.stopped || sending.current || !focused) return;
    const next = batch.queue[0];
    if (!next || read.busy || read.retry || !read.listReady) return;
    if (!read.records.some((record) => record.uuid === next)) {
      setBatch((current) => current && { ...current, queue: current.queue.slice(1) });
      return;
    }
    if (selectedUuid !== next) {
      select(next);
      return;
    }
    if (read.readFailed) {
      setBatch((current) => current && { ...current, stopped: next });
      return;
    }
    if (read.record?.uuid !== next || !read.requests) return;
    sending.current = true;
    void requestParticulars(batch.name, batch.address).then((confirmed) => {
      sending.current = false;
      setBatch(
        (current) =>
          current && (confirmed ? { ...current, queue: current.queue.slice(1) } : { ...current, stopped: next }),
      );
      void refetch();
    });
  }, [
    batch,
    focused,
    read.busy,
    read.retry,
    read.listReady,
    read.records,
    read.readFailed,
    read.record,
    read.requests,
    selectedUuid,
    select,
    requestParticulars,
    refetch,
  ]);
  const held = read.busy || !!read.retry;
  const waitsAt = (uuid: string, name: string, address: string) =>
    particulars.waitingAt(uuid).some((request) => request.name === name && request.residentialAddress === address);
  const targets = form
    ? companies.filter((record) => !waitsAt(record.uuid, form.name.trim(), form.address.trim()))
    : [];
  const send = () => {
    if (!form) return;
    setBatch({
      name: form.name.trim(),
      address: form.address.trim(),
      queue: targets.map((record) => record.uuid),
      stopped: null,
    });
    setForm(null);
  };
  const refresh = () => {
    if (read.busy || refreshing) return;
    setRefreshing(true);
    void Promise.all([read.refresh(), refetch()]).finally(() => setRefreshing(false));
  };
  const running = !!batch && !batch.stopped && batch.queue.length > 0;
  const matching = ({ name, address }: Batch) =>
    companies.filter((record) => waitsAt(record.uuid, name, address)).length;
  return (
    <Page
      testID="your-details-scroll"
      title="Your details"
      lede="As each company records them in its share register."
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.interactive.active} />
      }
    >
      <MemberNotice read={read} />
      {read.loading || (!read.listReady && !read.error) || particulars.loading ? (
        <Text style={styles.muted}>Loading your details…</Text>
      ) : companies.length === 0 ? (
        <Text style={styles.muted}>No company records you as a member yet.</Text>
      ) : (
        <>
          {particulars.failed && (
            <Text accessibilityRole="alert" style={styles.error}>
              Some change requests could not be loaded. Refresh before relying on this list.
            </Text>
          )}
          <View style={card.card}>
            <Rows>
              {companies.map((record) => {
                const waiting = particulars.waitingAt(record.uuid).length > 0;
                return (
                  <Pressable
                    key={record.uuid}
                    accessibilityRole="button"
                    accessibilityLabel={`${record.company.name}: ${record.name}, ${record.residentialAddress}${waiting ? ', change waiting' : ''}`}
                    onPress={() => navigation.navigate('Details', { record: record.uuid })}
                    style={look.row}
                  >
                    <Avatar name={record.company.name} />
                    <View style={look.text}>
                      <Text style={look.name}>{shortName(record.company.name)}</Text>
                      <Text style={styles.muted}>
                        {record.name} · {record.residentialAddress}
                      </Text>
                    </View>
                    {waiting && <CertificatePill certificate="requested" label="Waiting" />}
                    <CaretRightIcon size={16} color={theme.colors.text.muted} />
                  </Pressable>
                );
              })}
            </Rows>
          </View>
          {batch ? (
            <View style={look.group}>
              {running ? (
                <Text style={styles.text}>Sending to {nameOf(batch.queue[0])}…</Text>
              ) : batch.stopped ? (
                <>
                  <Text style={styles.text}>
                    Stopped at {nameOf(batch.stopped)}.{' '}
                    {read.retry ? 'Retry the interrupted request, then continue.' : 'Continue with the others.'}
                  </Text>
                  <Action
                    label="Continue with the remaining companies"
                    disabled={held}
                    onPress={() => {
                      void refetch();
                      setBatch((current) => current && { ...current, queue: current.queue.slice(1), stopped: null });
                    }}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.text}>
                    This change is now waiting at {matching(batch)} of {companies.length}{' '}
                    {companies.length === 1 ? 'company' : 'companies'}.
                  </Text>
                  <Action label="Done" onPress={() => setBatch(null)} />
                </>
              )}
            </View>
          ) : form ? (
            <View style={[card.card, look.group]}>
              <Text style={styles.muted}>
                Each company reviews the change separately. Sending it changes no holding or register particulars.
              </Text>
              <Field
                label="Requested name"
                value={form.name}
                editable={!held}
                onChange={(value) => setForm((current) => current && { ...current, name: value, confirmed: false })}
              />
              <Field
                label="Requested residential address"
                value={form.address}
                editable={!held}
                multiline
                onChange={(value) => setForm((current) => current && { ...current, address: value, confirmed: false })}
              />
              <Choice
                accessibilityRole="checkbox"
                selected={form.confirmed}
                disabled={held}
                label="Share these particulars with each company for review"
                onPress={() => setForm((current) => current && { ...current, confirmed: !current.confirmed })}
              />
              <Action
                label={
                  targets.length === 0
                    ? 'Already waiting at every company'
                    : `Send to ${targets.length} ${targets.length === 1 ? 'company' : 'companies'}`
                }
                primary
                disabled={held || targets.length === 0 || !form.confirmed || !form.name.trim() || !form.address.trim()}
                onPress={send}
              />
              <Action label="Cancel" disabled={read.busy} onPress={() => setForm(null)} />
            </View>
          ) : (
            <Action
              label="Change at every company"
              disabled={held}
              onPress={() => setForm({ name: '', address: '', confirmed: false })}
            />
          )}
        </>
      )}
    </Page>
  );
}

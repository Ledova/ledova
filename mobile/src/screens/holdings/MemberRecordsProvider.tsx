import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { RefreshControl, Text } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useMemberRecords, type OwnMemberRecord } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { useAppTheme } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';

export interface MemberDraft {
  name: string;
  address: string;
  confirmed: boolean;
}

const EMPTY_DRAFT: MemberDraft = { name: '', address: '', confirmed: false };

type Read = ReturnType<typeof useMemberRecords>;

interface MemberRecords {
  read: Read;
  draft: MemberDraft;
  setDraft: Dispatch<SetStateAction<MemberDraft>>;
  select: (uuid: string) => void;
  companies: OwnMemberRecord[];
  company: OwnMemberRecord | undefined;
  selectCompany: (companyUuid: string) => boolean;
}

const MemberRecordsContext = createContext<MemberRecords | null>(null);

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  const read = useMemberRecords(Crypto.randomUUID, orderSubmissionSession);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  useEffect(() => setDraft(EMPTY_DRAFT), [read.scopeOwner]);
  const companies = useMemo(
    () => [...read.records].sort((left, right) => left.company.name.localeCompare(right.company.name)),
    [read.records],
  );
  const key = read.owner ? `ledova.company.${read.owner.userUuid}.${read.owner.ownerAccountUuid}` : null;
  const [chosen, setChosen] = useState<{ key: string; company: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const keep = (company: string | null) =>
      live && setChosen((current) => (current?.key === key ? current : { key, company }));
    AsyncStorage.getItem(key).then(keep, () => keep(null));
    return () => {
      live = false;
    };
  }, [key]);
  const remembered = key && chosen?.key === key ? chosen.company : undefined;
  const company =
    remembered === undefined ? undefined : (companies.find((row) => row.company.uuid === remembered) ?? companies[0]);
  const busy = read.busy || !!read.retry;
  const selectCompany = useCallback(
    (companyUuid: string) => {
      if (!key || busy || !companies.some((row) => row.company.uuid === companyUuid)) return false;
      if (remembered === companyUuid) return true;
      setChosen({ key, company: companyUuid });
      AsyncStorage.setItem(key, companyUuid).catch(() => undefined);
      return true;
    },
    [key, busy, companies, remembered],
  );
  return (
    <MemberRecordsContext.Provider
      value={{
        read,
        draft,
        setDraft,
        select: (uuid) => {
          if (read.busy || read.retry || read.selectedUuid === uuid) return;
          setDraft(EMPTY_DRAFT);
          read.select(uuid);
        },
        companies,
        company,
        selectCompany,
      }}
    >
      {children}
    </MemberRecordsContext.Provider>
  );
}

export function useMemberRecordsState() {
  const value = useContext(MemberRecordsContext);
  if (!value) throw new Error('Member records need their signed-in provider.');
  return value;
}

export function useCompanyRecord(uuid: string) {
  const state = useMemberRecordsState();
  const { read, select } = state;
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && read.owner && read.records.some((row) => row.uuid === uuid) && !read.busy && !read.retry)
      select(uuid);
  }, [focused, read.owner, read.records, read.busy, read.retry, select, uuid]);
  return {
    ...state,
    focused,
    record: read.records.find((row) => row.uuid === uuid),
    selected: read.record?.uuid === uuid ? read.record : null,
  };
}

export function MemberNotice({ read }: { read: Read }) {
  const styles = useCompanyStyles();
  const pending = read.retry && read.retry.kind !== 'accept' ? read.record?.company.name : undefined;
  return (
    <>
      {read.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {read.error}
        </Text>
      )}
      {pending && <Text style={styles.muted}>Your request to {pending} is waiting to be retried.</Text>}
      {read.retry && (
        <Action label="Retry original member action" disabled={read.busy} onPress={() => void read.recover()} />
      )}
    </>
  );
}

export function RecordGate({
  read,
  record,
  ready,
  children,
}: {
  read: Read;
  record: Read['records'][number] | undefined;
  ready: boolean;
  children: ReactNode;
}) {
  const styles = useCompanyStyles();
  if (!read.owner) return <Text style={styles.muted}>Check your signed-in account before opening member records.</Text>;
  if (read.loading || (!read.listReady && !read.error))
    return <Text style={styles.muted}>Loading member records…</Text>;
  if (!record)
    return read.error ? null : <Text style={styles.muted}>This company no longer records you as a member.</Text>;
  if (!ready) {
    if (read.retry)
      return <Text style={styles.muted}>Retry or finish your pending request before opening this company.</Text>;
    return read.error ? null : <Text style={styles.muted}>Loading member records…</Text>;
  }
  return <>{children}</>;
}

export function useMemberRefresh(read: Read, testID?: string) {
  const theme = useAppTheme();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <RefreshControl
      testID={testID}
      refreshing={refreshing}
      tintColor={theme.colors.interactive.active}
      onRefresh={() => {
        if (read.busy || refreshing) return;
        setRefreshing(true);
        void read.refresh().finally(() => setRefreshing(false));
      }}
    />
  );
}

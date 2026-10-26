import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import * as Crypto from 'expo-crypto';
import { RefreshControl, Text } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useMemberRecords } from '@ledova/shared';
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
}

const MemberRecordsContext = createContext<MemberRecords | null>(null);

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  const read = useMemberRecords(Crypto.randomUUID, orderSubmissionSession);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  useEffect(() => setDraft(EMPTY_DRAFT), [read.scopeOwner]);
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

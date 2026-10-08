import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  getErrorMessage,
  getPauseSubmission,
  pauseCompanyToken,
  unpauseCompanyToken,
  useSubmissionOwner,
  type CompanyShareToken,
  type OrderSubmissionOwner,
  type PauseSubmissionResponse,
  type SavedPause,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { getSessionEpoch, assertSessionEpoch } from '../../services/sessionScope';
import { pauseSubmissionStore } from '../../services/pauseSubmissions';
import { useCompanyStyles } from '../company-register/styles';

type Props = {
  token: Pick<CompanyShareToken, 'uuid' | 'status'>;
  refreshing: boolean;
};

function checked(record: SavedPause, response: PauseSubmissionResponse) {
  if (
    response.submission.uuid !== record.submissionId ||
    response.submission.paused !== record.paused ||
    response.token.uuid !== record.tokenUuid
  )
    throw new Error('The server returned a different pause submission. The original request remains saved.');
  return response;
}

function PauseRequests({
  token,
  refreshing,
  owner,
  currentOwner,
}: Props & { owner: OrderSubmissionOwner; currentOwner: () => OrderSubmissionOwner | null }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const [epoch] = useState(getSessionEpoch);
  const live = useRef(true);
  const current = useCallback(() => live.current && currentOwner() === owner, [currentOwner, owner]);
  const guard = useCallback(() => {
    assertSessionEpoch(epoch);
    if (!current()) throw new Error('The issuer session changed. Reopen the share class to continue.');
  }, [epoch, current]);
  const [records, setRecords] = useState<SavedPause[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    try {
      guard();
      const saved = await pauseSubmissionStore.list(owner, token.uuid);
      guard();
      setRecords((previous) => [
        ...previous,
        ...saved.filter((record) => !previous.some((existing) => existing.submissionId === record.submissionId)),
      ]);
      setReady(true);
      setStorageError(null);
    } catch (failure) {
      if (current()) {
        setReady(false);
        setStorageError(getErrorMessage(failure, 'Saved pause requests could not be read.'));
      }
    }
  }, [guard, current, owner, token.uuid]);
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  const queryKey = (record: SavedPause) => [
    'pause-submission',
    record.userUuid,
    record.ownerAccountUuid,
    record.tokenUuid,
    record.submissionId,
    epoch,
  ];
  const refreshClass = () => {
    void queryClient.invalidateQueries({ queryKey: ['company-token', token.uuid] });
    void queryClient.invalidateQueries({ queryKey: ['company-tokens'] });
  };
  const queries = useQueries({
    queries: records.map((record) => ({
      queryKey: queryKey(record),
      queryFn: async () => {
        guard();
        const response = await getPauseSubmission(apiClient, token.uuid, record.submissionId, {
          ledovaSubmissionGuard: guard,
          ledovaSessionEpoch: epoch,
        });
        guard();
        const result = checked(record, response.data);
        refreshClass();
        return result;
      },
      retry: false,
      refetchInterval: (query: { state: { data?: PauseSubmissionResponse } }) =>
        query.state.data?.submission.completedAt ? (false as const) : 5000,
    })),
  });
  const send = async (previous: SavedPause) => {
    const paused = previous.paused;
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      guard();
      const record = await pauseSubmissionStore.retain(previous);
      guard();
      await load();
      guard();
      const response = await (paused ? pauseCompanyToken : unpauseCompanyToken)(
        apiClient,
        token.uuid,
        { submissionId: record.submissionId },
        { ledovaSubmissionGuard: guard, ledovaSessionEpoch: epoch },
      );
      guard();
      queryClient.setQueryData(queryKey(record), checked(record, response.data));
      refreshClass();
    } catch (failure) {
      if (current()) {
        setError(getErrorMessage(failure, 'The pause response is unresolved. Check or retry the saved request.'));
        await load();
      }
    } finally {
      inFlight.current = false;
      if (current()) setSending(false);
    }
  };
  const dismiss = async (record: SavedPause) => {
    try {
      guard();
      await pauseSubmissionStore.remove(record);
      guard();
      setRecords((previous) => previous.filter((existing) => existing.submissionId !== record.submissionId));
      await load();
    } catch (failure) {
      if (current()) setError(getErrorMessage(failure, 'The completed reminder could not be cleared.'));
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.muted}>
        A saved request records its original outcome. Check the class state above for its current status.
      </Text>
      {!ready && !storageError && <Text style={styles.muted}>Loading saved pause requests…</Text>}
      {refreshing && <Text style={styles.muted}>Refreshing the current share class…</Text>}
      <Text style={styles.muted}>Retained issuer requests. Prepare new pause decisions in the company panel.</Text>
      {storageError && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            {storageError}
          </Text>
          <Action label="Reload saved requests" onPress={() => void load()} />
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {records.map((record, index) => {
        const query = queries[index];
        const response = query.data;
        return (
          <View key={record.submissionId} style={styles.entry}>
            <Text selectable style={styles.text}>
              {record.paused ? 'Pause' : 'Unpause'} request {record.submissionId}
            </Text>
            <Text style={styles.muted}>
              {response?.message ?? 'Outcome unresolved. This request remains saved on this device.'}
            </Text>
            {query.error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {getErrorMessage(query.error, 'The request outcome could not be checked.')}
              </Text>
            )}
            {response?.submission.completedAt ? (
              <Action label="Dismiss outcome" onPress={() => void dismiss(record)} />
            ) : (
              <>
                <Action label="Check outcome" disabled={query.isFetching} onPress={() => void query.refetch()} />
                <Action label="Retry same request" disabled={sending} onPress={() => void send(record)} />
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function TokenPauseControls(props: Props) {
  const styles = useCompanyStyles();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  return (
    <Section title="Retained issuer pause requests">
      {owner ? (
        <PauseRequests
          key={`${owner.userUuid}/${owner.ownerAccountUuid}/${props.token.uuid}/${getSessionEpoch()}`}
          {...props}
          owner={owner}
          currentOwner={boundary.get}
        />
      ) : (
        <Text style={styles.muted}>Verify your issuer session before reading retained pause requests.</Text>
      )}
    </Section>
  );
}

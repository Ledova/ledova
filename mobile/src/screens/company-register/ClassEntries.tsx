import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  formatDate,
  formatDateTime,
  hasCurrentRegisterReadAuthority,
  useSubmissionOwner,
  USER_PREFERENCES_QUERY_KEY,
  formatRegisterChanges,
  REGISTER_CORRECTION_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterEntry,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { registerAppointmentsKey, useRegisterEntries } from '../../hooks/useCompanyRegister';
import { RegisterCertificate } from './RegisterCertificate';
import { orderSubmissionSession } from '../../services/orderSubmissions';

export const NOT_LOADED = 'An entry not loaded yet';

export function ClassEntries({
  epoch,
  register,
  steps,
  onCorrect,
  company,
  sourceReady,
}: {
  epoch: number;
  company: string;
  sourceReady: boolean;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  onCorrect: (entry: RegisterEntry) => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const certificateGuard = () => {
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const state = client.getQueryState<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch));
    if (
      !owner ||
      boundary.get() !== owner ||
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(state.data ?? [], company)
    )
      throw new Error('Refresh current company register authority before preparing a certificate.');
  };
  const name = register.token.name;
  const { entries, listed, hasError, moreFailed, loadMore } = useRegisterEntries(epoch, register.token.uuid);
  const sequences = new Map(listed.map((entry) => [entry.uuid, entry.sequence]));
  const linked = (uuid: string) => (sequences.has(uuid) ? `Entry ${sequences.get(uuid)}` : NOT_LOADED);
  const more = entries.isFetchingNextPage ? 'Loading entries…' : 'Load more entries';
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.ENTRIES_TITLE}
      </Text>
      {entries.isPending ? (
        <Text style={styles.muted}>Loading register entries…</Text>
      ) : hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The register entries could not be loaded.
          </Text>
          <Action
            label="Retry register entries"
            accessibilityLabel={`Retry register entries for ${name}`}
            disabled={entries.isFetching}
            onPress={() => void entries.refetch()}
          />
        </View>
      ) : listed.length === 0 ? (
        <Text style={styles.muted}>{COPY.ENTRIES_EMPTY}</Text>
      ) : (
        <>
          {listed.map((entry, index) => (
            <View key={entry.uuid} style={[styles.entry, index === listed.length - 1 && styles.lastEntry]}>
              <Text style={styles.heading}>
                Entry {entry.sequence} · {COPY.ENTRY_KINDS[entry.kind]}
              </Text>
              <Text style={styles.muted}>Ledger effective date {formatDate(entry.effectiveOn)}</Text>
              {['issue', 'transfer'].includes(entry.kind) && (
                <Text style={styles.muted}>
                  Company event date {entry.companyEventOn ? formatDate(entry.companyEventOn) : 'Not recorded'}
                </Text>
              )}
              <Text style={styles.muted}>Recorded {formatDateTime(entry.recordedAt)}</Text>
              {formatRegisterChanges(entry.changes).map((line, number) => (
                <Text key={number} style={styles.text}>
                  {line}
                </Text>
              ))}
              {!!(entry.corrects || entry.correctedBy) && (
                <Rows>
                  {!!entry.corrects && <Row label="Corrects">{linked(entry.corrects)}</Row>}
                  {!!entry.correctedBy && <Row label="Reversed by">{linked(entry.correctedBy)}</Row>}
                </Rows>
              )}
              {['issue', 'transfer'].includes(entry.kind) && entry.correctedBy === null && (
                <RegisterCertificate
                  epoch={epoch}
                  register={register}
                  entry={entry}
                  disabled={!sourceReady || entries.isFetching || moreFailed}
                  authorityGuard={certificateGuard}
                />
              )}
              {entry.correctable && steps?.prepare && (
                <Action
                  label={COPY.PREPARE}
                  accessibilityLabel={`${COPY.PREPARE}, entry ${entry.sequence} of ${name}`}
                  onPress={() => onCorrect(entry)}
                />
              )}
            </View>
          ))}
          {moreFailed ? (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.error}>
                More register entries could not be loaded. The history above is incomplete.
              </Text>
              <Action
                label="Try more entries again"
                accessibilityLabel={`Try more entries again for ${name}`}
                disabled={entries.isFetching}
                onPress={() => void loadMore()}
              />
            </View>
          ) : (
            entries.hasNextPage && (
              <Action
                label={more}
                accessibilityLabel={`${more} for ${name}`}
                disabled={entries.isFetching}
                onPress={() => void loadMore()}
              />
            )
          )}
        </>
      )}
    </View>
  );
}
